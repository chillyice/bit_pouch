//! 软件更新：Tauri updater + 可切换更新源 + Ed25519 签名。
//!
//! 与咔哒（Kada）同一套更新模型：
//! - **检查**永远自动：启动 8 秒后查一次，之后每 24 小时再查；手动「检查更新」只是立刻再查。
//! - **下载**：开了「自动更新」发现新版本后直接下；没开只能在设置页点「下载」。
//!   下载完落盘到 `app_data_dir/updates/`，重启后仍能恢复（`pending.json`）。
//! - **安装**：开了自动更新时 Windows 在长时间空闲后装；免安装版另在下次启动时装；
//!   其余平台在下次启动时装。没开则只能手动点「安装」。
//!
//! 更新源默认 ihomy 镜像（服务器每天从 GitHub Releases 同步），能直连 GitHub 的用户可在
//! 设置页切换。两份清单格式相同、签名原样保留，客户端只认签名——镜像换 URL 不影响校验。
//!
//! 安装形态（[`InstallKind`]）决定用哪种包，且绝不交叉：安装版只拿 NSIS 安装包、装回注册表
//! 记录的原目录；免安装版只拿清单里的 `windows-x86_64-portable` 裸 exe，原位替换后重启。

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::{Manager, Url};
use tauri_plugin_updater::{Error as UpdateError, Update, Updater, UpdaterExt};

/// 启动后台检查的延迟（秒）：避开启动瞬间的窗口初始化。
const STARTUP_CHECK_DELAY_SECS: u64 = 8;

/// 启动检查之后的自动检查间隔：应用常驻时也要能在一天内看到新版本。
const CHECK_INTERVAL_SECS: u64 = 24 * 60 * 60;

/// 清单请求的时限（秒）：`latest.json` 只有几 KB，这么久没回来就是网络或更新源不可达。
const CHECK_TIMEOUT_SECS: u64 = 20;

/// 勾了自动更新时，「长时间不使用电脑」的判定门槛（秒）。
const AUTO_INSTALL_IDLE_SECS: u64 = 10 * 60;

/// 自动安装调度的巡检间隔（秒）。
const AUTO_INSTALL_POLL_SECS: u64 = 30;

/// 第一次巡检的延迟（秒）：给窗口留出启动时间，也避免和启动检查撞在一起。
const AUTO_INSTALL_STARTUP_DELAY_SECS: u64 = 10;

/// 自动安装失败后的冷却（秒）：离线时别每 30 秒重试一次。
const AUTO_INSTALL_RETRY_SECS: u64 = 10 * 60;

/// 更新源。
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum UpdateSource {
    /// ihomy 镜像（默认）：服务器每天从 GitHub Releases 同步。
    #[default]
    Ihomy,
    /// 官方 GitHub Releases。
    Github,
}

impl UpdateSource {
    /// 该更新源的 `latest.json` 地址。
    pub fn endpoint(self) -> &'static str {
        match self {
            UpdateSource::Ihomy => "https://ihomy.top/files/bit_pouch/updates/latest.json",
            UpdateSource::Github => {
                "https://github.com/chillyice/bit_pouch/releases/latest/download/latest.json"
            }
        }
    }
}

/// 更新相关设置（与工具偏好分开，落盘在 `app_data_dir/update-settings.json`）。
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default)]
pub struct UpdateSettings {
    pub source: UpdateSource,
    pub auto_update: bool,
}

/// 更新阶段（连同该阶段的字段一起序列化给前端，前端按 `phase` 分支渲染）。
#[derive(Clone, Debug, Serialize)]
#[serde(tag = "phase", rename_all = "kebab-case")]
pub enum UpdatePhase {
    /// 本次运行还没查过。
    Idle,
    /// 正在检查清单。
    Checking,
    /// 已是最新版本。
    UpToDate,
    /// 发现新版本，尚未下载。
    Available { version: String, notes: Option<String> },
    /// 正在下载。
    Downloading { version: String, percent: Option<f64> },
    /// 已下载、等安装。
    Ready { version: String },
    /// 正在安装。
    Installing { version: String },
    /// 出错。`code` 给前端做本地化，`detail` 是底层错误的简短原文。
    Error { code: String, detail: String },
}

impl UpdatePhase {
    /// 是否进行中：进行中不再发起第二次检查 / 下载 / 安装。
    fn busy(&self) -> bool {
        matches!(
            self,
            UpdatePhase::Checking | UpdatePhase::Downloading { .. } | UpdatePhase::Installing { .. }
        )
    }
}

/// 当前程序的安装形态。更新这一步不允许改变形态。
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum InstallKind {
    /// NSIS 安装版：更新走安装器，装回注册表记录的原目录。
    Installed,
    /// 免安装版（裸 exe）：更新用清单里的裸 exe 原位替换自己。
    Portable,
}

/// 注册表里 NSIS 安装器写下的安装目录（HKCU = 当前用户，HKLM = 全机）。
#[cfg(windows)]
fn registered_install_dir() -> Option<PathBuf> {
    use windows_registry::{CURRENT_USER, LOCAL_MACHINE};

    // Tauri NSIS 模板：`Software\{MANUFACTURER}\{PRODUCTNAME}`，即 Software\ihomy\bit_pouch。
    const KEY: &str = r"Software\ihomy\bit_pouch";
    for root in [CURRENT_USER, LOCAL_MACHINE] {
        let Ok(key) = root.open(KEY) else { continue };
        let Ok(dir) = key.get_string("") else { continue };
        let dir = dir.trim().trim_matches('"');
        if !dir.is_empty() {
            return Some(PathBuf::from(dir));
        }
    }
    None
}

/// 目录比较：大小写不敏感、尾部分隔符可有可无。
fn same_dir(a: &Path, b: &Path) -> bool {
    fn norm(p: &Path) -> String {
        p.to_string_lossy()
            .replace('/', "\\")
            .trim_end_matches('\\')
            .to_lowercase()
    }
    norm(a) == norm(b)
}

/// 纯判定：exe 目录与注册表记录的安装目录一致才算安装版。
/// 取不到自身目录或注册表没有记录时按免安装处理——宁可只提示手动替换，也不擅自跑安装器。
fn classify_install(exe_dir: Option<&Path>, registered: Option<&Path>) -> InstallKind {
    match (exe_dir, registered) {
        (Some(dir), Some(installed)) if same_dir(dir, installed) => InstallKind::Installed,
        _ => InstallKind::Portable,
    }
}

/// 当前进程的安装形态。非 Windows 只有安装版一种分发形态。
pub fn install_kind() -> InstallKind {
    #[cfg(windows)]
    {
        let exe_dir = std::env::current_exe()
            .ok()
            .and_then(|exe| exe.parent().map(Path::to_path_buf));
        classify_install(exe_dir.as_deref(), registered_install_dir().as_deref())
    }
    #[cfg(not(windows))]
    {
        InstallKind::Installed
    }
}

/// 清单里该形态该读哪个平台条目：免安装版读裸 exe 条目。
fn manifest_target(kind: InstallKind) -> Option<&'static str> {
    #[cfg(windows)]
    if kind == InstallKind::Portable {
        return Some("windows-x86_64-portable");
    }
    let _ = kind;
    None
}

/// 已下载、待安装的更新包（落盘成 `updates/pending.json`）。
#[derive(Clone, Debug, Serialize, Deserialize)]
struct PendingUpdate {
    version: String,
    file: String,
    kind: InstallKind,
}

/// 更新状态快照。
#[derive(Clone, Debug, Serialize)]
pub struct UpdateStatus {
    pub current: String,
    pub kind: InstallKind,
    #[serde(flatten)]
    pub phase: UpdatePhase,
}

/// 更新器运行时状态。
pub struct UpdateState {
    status: Mutex<UpdateStatus>,
    dir: PathBuf,
    settings_path: PathBuf,
    settings: Mutex<UpdateSettings>,
    pending: Mutex<Option<PendingUpdate>>,
}

impl UpdateState {
    pub fn new(current: String, dir: PathBuf, settings_path: PathBuf) -> Self {
        cleanup_stale_binaries();
        let settings = load_settings(&settings_path);
        let kind = install_kind();
        let pending = load_pending(&dir, &current, kind);
        let phase = match &pending {
            Some(p) => UpdatePhase::Ready { version: p.version.clone() },
            None => UpdatePhase::Idle,
        };
        Self {
            status: Mutex::new(UpdateStatus { current, kind, phase }),
            dir,
            settings_path,
            settings: Mutex::new(settings),
            pending: Mutex::new(pending),
        }
    }

    pub fn snapshot(&self) -> UpdateStatus {
        self.status.lock().unwrap().clone()
    }

    fn pending(&self) -> Option<PendingUpdate> {
        self.pending.lock().unwrap().clone()
    }

    fn settings(&self) -> UpdateSettings {
        self.settings.lock().unwrap().clone()
    }
}

/// 写入阶段并推给前端。
fn set_phase(app: &tauri::AppHandle, phase: UpdatePhase) {
    let status = {
        let state = app.state::<UpdateState>();
        let mut status = state.status.lock().unwrap();
        status.phase = phase;
        status.clone()
    };
    let _ = tauri::Emitter::emit(app, "update-status", status);
}

/// 把检查清单的错误翻成「错误码 + 简短原文」，前端按 code 本地化。
fn check_error_text(err: &UpdateError) -> (String, String) {
    match err {
        UpdateError::Reqwest(e) if e.is_timeout() => ("timeout".into(), e.to_string()),
        UpdateError::Reqwest(e) if e.is_connect() => ("connect".into(), e.to_string()),
        UpdateError::Reqwest(e) => ("network".into(), e.to_string()),
        UpdateError::ReleaseNotFound => ("release-not-found".into(), String::new()),
        UpdateError::TargetNotFound(target) => ("target-not-found".into(), target.clone()),
        UpdateError::TargetsNotFound(targets) => {
            ("targets-not-found".into(), targets.join(", "))
        }
        UpdateError::Serialization(e) => ("bad-manifest".into(), e.to_string()),
        UpdateError::Semver(e) => ("bad-version".into(), e.to_string()),
        UpdateError::EmptyEndpoints => ("no-endpoint".into(), String::new()),
        UpdateError::InsecureTransportProtocol => ("insecure-transport".into(), String::new()),
        other => ("check-failed".into(), other.to_string()),
    }
}

/// 下载/校验更新包的错误。
fn download_error_text(err: &UpdateError) -> (String, String) {
    match err {
        UpdateError::Minisign(_) => ("signature".into(), String::new()),
        UpdateError::SignatureUtf8(e) => ("signature-format".into(), e.to_string()),
        UpdateError::Base64(e) => ("signature-format".into(), e.to_string()),
        UpdateError::MissingSignedVersion => ("missing-signed-version".into(), String::new()),
        UpdateError::SignedVersionMismatch { signed, announced } => (
            "version-mismatch".into(),
            format!("{signed} -> {announced}"),
        ),
        UpdateError::Network(msg) => ("network".into(), msg.clone()),
        UpdateError::Reqwest(e) if e.is_timeout() => ("download-timeout".into(), e.to_string()),
        UpdateError::Reqwest(e) => ("download-network".into(), e.to_string()),
        other => ("download-failed".into(), other.to_string()),
    }
}

/// 记失败：写状态；自动模式只留状态，不弹窗。
fn fail(app: &tauri::AppHandle, code: String, detail: String) {
    set_phase(app, UpdatePhase::Error { code, detail });
}

/// 发起一次检查（已在检查/下载/安装中则忽略）。
pub fn spawn(app: &tauri::AppHandle) {
    if app.state::<UpdateState>().snapshot().phase.busy() {
        return;
    }
    set_phase(app, UpdatePhase::Checking);
    let app = app.clone();
    tauri::async_runtime::spawn(async move { run(app).await });
}

/// 按当前设置装配更新器。
fn build_updater(app: &tauri::AppHandle, kind: InstallKind, source: UpdateSource) -> Result<Updater, String> {
    let mut builder = app
        .updater_builder()
        .endpoints(vec![Url::parse(source.endpoint()).map_err(|e| e.to_string())?])
        .map_err(|e| format!("更新源地址无效：{e}"))?;
    if let Some(target) = manifest_target(kind) {
        builder = builder.target(target);
    }
    builder = builder.timeout(Duration::from_secs(CHECK_TIMEOUT_SECS));
    builder.build().map_err(|e| format!("更新器初始化失败：{e}"))
}

/// 启动后台检查 + 每日复查。
/// 只在 release 构建里跑：dev 查的是线上清单，版本号还是开发中的号。
pub fn spawn_periodic_check(app: &tauri::AppHandle) {
    if cfg!(debug_assertions) {
        return;
    }
    let app = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_secs(STARTUP_CHECK_DELAY_SECS));
        loop {
            spawn(&app);
            std::thread::sleep(Duration::from_secs(CHECK_INTERVAL_SECS));
        }
    });
}

/// 自动安装调度：勾了「自动更新」时，把已下载的包择机装掉。
///
/// - 免安装版：下次启动时（第一轮巡检）装，另在 Windows 空闲时也可装。
/// - 安装版：Windows 在长时间空闲时装；其它平台在下次启动时装。
pub fn spawn_auto_installer(app: &tauri::AppHandle) {
    if cfg!(debug_assertions) {
        return;
    }
    let app = app.clone();
    std::thread::spawn(move || {
        let mut first_pass = true;
        let mut last_attempt: Option<std::time::Instant> = None;
        loop {
            std::thread::sleep(Duration::from_secs(if first_pass {
                AUTO_INSTALL_STARTUP_DELAY_SECS
            } else {
                AUTO_INSTALL_POLL_SECS
            }));
            let startup_pass = std::mem::replace(&mut first_pass, false);
            let Some(pending) = app.state::<UpdateState>().pending() else { continue };
            if !app.state::<UpdateState>().settings().auto_update {
                continue;
            }
            let kind = install_kind();
            let startup_due = startup_pass && (kind == InstallKind::Portable || cfg!(not(windows)));
            let idle_due = matches!(
                idle_seconds(),
                Some(secs) if secs >= AUTO_INSTALL_IDLE_SECS
            );
            if !startup_due && !idle_due {
                continue;
            }
            if last_attempt.is_some_and(|t| t.elapsed() < Duration::from_secs(AUTO_INSTALL_RETRY_SECS)) {
                continue;
            }
            last_attempt = Some(std::time::Instant::now());
            install_pending(&app, &pending, true);
        }
    });
}

/// 检查 + 按设置决定后续动作。
async fn run(app: tauri::AppHandle) {
    let kind = install_kind();
    let settings = app.state::<UpdateState>().settings();
    let source = settings.source;
    let updater = match build_updater(&app, kind, source) {
        Ok(updater) => updater,
        Err(detail) => return fail(&app, "init".into(), detail),
    };

    let found = match updater.check().await {
        Ok(found) => found,
        Err(e) => {
            let (code, detail) = check_error_text(&e);
            return fail(&app, code, detail);
        }
    };

    let Some(update) = found else {
        set_phase(&app, UpdatePhase::UpToDate);
        return;
    };

    let version = update.version.clone();
    set_phase(
        &app,
        UpdatePhase::Available { version: version.clone(), notes: update.body.clone() },
    );

    // 这个版本已经下过了（可能还是上一次运行里下的）：不重复下载。
    if app.state::<UpdateState>().pending().is_some_and(|p| p.version == version) {
        set_phase(&app, UpdatePhase::Ready { version });
        return;
    }

    if settings.auto_update {
        if let Err((code, detail)) = download_into(&app, update).await {
            fail(&app, code, detail);
        }
    }
}

/// 下载当前可用版本。
pub fn spawn_download(app: tauri::AppHandle) {
    if app.state::<UpdateState>().snapshot().phase.busy() {
        return;
    }
    set_phase(&app, UpdatePhase::Checking);
    let kind = install_kind();
    let source = app.state::<UpdateState>().settings().source;
    tauri::async_runtime::spawn(async move {
        let updater = match build_updater(&app, kind, source) {
            Ok(updater) => updater,
            Err(detail) => return fail(&app, "init".into(), detail),
        };
        let update = match updater.check().await {
            Ok(Some(update)) => update,
            Ok(None) => {
                set_phase(&app, UpdatePhase::UpToDate);
                return;
            }
            Err(e) => {
                let (code, detail) = check_error_text(&e);
                return fail(&app, code, detail);
            }
        };
        if app.state::<UpdateState>().pending().is_some_and(|p| p.version == update.version) {
            set_phase(&app, UpdatePhase::Ready { version: update.version.clone() });
            return;
        }
        if let Err((code, detail)) = download_into(&app, update).await {
            fail(&app, code, detail);
        }
    });
}

/// 下载并落盘：阶段从 Downloading 走到 Ready。
async fn download_into(app: &tauri::AppHandle, update: Update) -> Result<(), (String, String)> {
    let version = update.version.clone();
    set_phase(
        app,
        UpdatePhase::Downloading { version: version.clone(), percent: None },
    );

    let downloaded = AtomicU64::new(0);
    let last_percent = AtomicU64::new(u64::MAX);
    let app_for_progress = app.clone();
    let version_for_progress = version.clone();
    let bytes = update
        .download(
            move |chunk: usize, total: Option<u64>| {
                let got = downloaded.fetch_add(chunk as u64, Ordering::Relaxed) + chunk as u64;
                let Some(percent) = progress_percent(got, total) else { return };
                if !should_emit_progress(&last_percent, percent) {
                    return;
                }
                set_phase(
                    &app_for_progress,
                    UpdatePhase::Downloading {
                        version: version_for_progress.clone(),
                        percent: Some(percent as f64),
                    },
                );
            },
            || {},
        )
        .await
        .map_err(|e| download_error_text(&e))?;

    persist(app, &version, &bytes).map_err(|e| ("persist".into(), e))?;
    set_phase(app, UpdatePhase::Ready { version });
    Ok(())
}

/// 由累计下载字节与总字节算整数百分比；总字节未知 / 为 0 时返回 None。
fn progress_percent(got: u64, total: Option<u64>) -> Option<u64> {
    let total = total.filter(|t| *t > 0)?;
    let percent = (got.min(total) as u128 * 100 / total as u128).min(100);
    Some(percent as u64)
}

/// 进度节流：整数百分比与上次相同就不推。
fn should_emit_progress(last: &AtomicU64, percent: u64) -> bool {
    last.swap(percent, Ordering::Relaxed) != percent
}

/// 把下载好的包写进 updates 目录并记下 pending.json。
fn persist(app: &tauri::AppHandle, version: &str, bytes: &[u8]) -> Result<(), String> {
    let state = app.state::<UpdateState>();
    let dir = state.dir.clone();
    std::fs::create_dir_all(&dir).map_err(|e| format!("创建更新目录失败：{e}"))?;
    let file = format!("update-{version}.pkg");
    let tmp = dir.join(format!("{file}.tmp"));
    std::fs::write(&tmp, bytes).map_err(|e| format!("写入更新包失败：{e}"))?;
    std::fs::rename(&tmp, dir.join(&file)).map_err(|e| format!("写入更新包失败：{e}"))?;
    let pending = PendingUpdate {
        version: version.to_string(),
        file,
        kind: install_kind(),
    };
    write_pending(&dir, &pending)?;
    cleanup_packages(&dir, version);
    state.pending.lock().unwrap().replace(pending);
    Ok(())
}

fn write_pending(dir: &Path, pending: &PendingUpdate) -> Result<(), String> {
    let json =
        serde_json::to_vec_pretty(pending).map_err(|e| format!("序列化更新状态失败：{e}"))?;
    let tmp = dir.join("pending.json.tmp");
    std::fs::write(&tmp, json).map_err(|e| format!("写入更新状态失败：{e}"))?;
    std::fs::rename(&tmp, dir.join("pending.json")).map_err(|e| format!("写入更新状态失败：{e}"))
}

fn load_pending(dir: &Path, current: &str, kind: InstallKind) -> Option<PendingUpdate> {
    let text = std::fs::read_to_string(dir.join("pending.json")).ok()?;
    let pending: PendingUpdate = match serde_json::from_str(&text) {
        Ok(pending) => pending,
        Err(_) => {
            clear_pending_dir(dir);
            return None;
        }
    };
    if pending.kind != kind || pending.version == current || !dir.join(&pending.file).exists() {
        clear_pending_dir(dir);
        return None;
    }
    Some(pending)
}

fn clear_pending_dir(dir: &Path) {
    if let Ok(text) = std::fs::read_to_string(dir.join("pending.json")) {
        if let Ok(pending) = serde_json::from_str::<PendingUpdate>(&text) {
            let _ = std::fs::remove_file(dir.join(&pending.file));
        }
    }
    let _ = std::fs::remove_file(dir.join("pending.json"));
}

fn clear_pending(app: &tauri::AppHandle) {
    let state = app.state::<UpdateState>();
    clear_pending_dir(&state.dir);
    state.pending.lock().unwrap().take();
}

fn cleanup_packages(dir: &Path, keep_version: &str) {
    let Ok(entries) = std::fs::read_dir(dir) else { return };
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().to_string();
        if name.starts_with("update-") && name != format!("update-{keep_version}.pkg") {
            let _ = std::fs::remove_file(entry.path());
        }
    }
}

fn load_settings(path: &Path) -> UpdateSettings {
    std::fs::read_to_string(path)
        .ok()
        .and_then(|text| serde_json::from_str(&text).ok())
        .unwrap_or_default()
}

fn save_settings(path: &Path, settings: &UpdateSettings) -> Result<(), String> {
    let json = serde_json::to_vec_pretty(settings)
        .map_err(|e| format!("序列化更新设置失败：{e}"))?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("创建设置目录失败：{e}"))?;
    }
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, json).map_err(|e| format!("写入更新设置失败：{e}"))?;
    std::fs::rename(&tmp, path).map_err(|e| format!("写入更新设置失败：{e}"))
}

/// 清掉上次替换留下的 `bit_pouch.exe.old-*` / 未完成的 `bit_pouch.exe.new`。
#[cfg(windows)]
fn cleanup_stale_binaries() {
    let Ok(exe) = std::env::current_exe() else { return };
    let Some(dir) = exe.parent() else { return };
    let Ok(entries) = std::fs::read_dir(dir) else { return };
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().to_string();
        if name.starts_with("bit_pouch.exe.old-") || name == "bit_pouch.exe.new" {
            let _ = std::fs::remove_file(entry.path());
        }
    }
}

#[cfg(not(windows))]
fn cleanup_stale_binaries() {}

/// 系统空闲秒数。Windows 用 GetLastInputInfo；其它平台返回 None（按「不知道」处理）。
#[cfg(windows)]
fn idle_seconds() -> Option<u64> {
    use windows_sys::Win32::System::SystemInformation::GetTickCount;
    use windows_sys::Win32::UI::Input::KeyboardAndMouse::{GetLastInputInfo, LASTINPUTINFO};

    let mut info = LASTINPUTINFO {
        cbSize: std::mem::size_of::<LASTINPUTINFO>() as u32,
        dwTime: 0,
    };
    if unsafe { GetLastInputInfo(&mut info) } == 0 {
        return None;
    }
    let now = unsafe { GetTickCount() };
    // 用 wrapping_sub：GetTickCount 约 49 天回绕一次，saturating_sub 会在回绕时误判为空闲 0 秒。
    Some((now.wrapping_sub(info.dwTime) as u64) / 1000)
}

#[cfg(not(windows))]
fn idle_seconds() -> Option<u64> {
    None
}

/// 安装当前待装的包。`quiet` = 自动调度触发。
fn install_pending(app: &tauri::AppHandle, pending: &PendingUpdate, quiet: bool) {
    if app.state::<UpdateState>().snapshot().phase.busy() {
        return;
    }
    let kind = install_kind();
    if pending.kind != kind {
        // 形态不匹配的包绝不能装：会把程序弄成半个安装版。
        clear_pending(app);
        set_phase(app, UpdatePhase::Idle);
        if !quiet {
            fail(app, "kind-mismatch".into(), String::new());
        }
        return;
    }
    set_phase(app, UpdatePhase::Installing { version: pending.version.clone() });
    match kind {
        InstallKind::Portable => {
            if let Err(e) = apply_portable_update(app, pending) {
                fail(app, "install".into(), e);
            }
        }
        InstallKind::Installed => {
            let app = app.clone();
            let pending = pending.clone();
            tauri::async_runtime::spawn(async move { install_via_updater(app, pending).await });
        }
    }
}

/// 安装版：重新核对清单，再把已下载的字节交给 updater。
async fn install_via_updater(app: tauri::AppHandle, pending: PendingUpdate) {
    let settings = app.state::<UpdateState>().settings();
    let source = settings.source;
    let updater = match build_updater(&app, InstallKind::Installed, source) {
        Ok(updater) => updater,
        Err(detail) => return fail(&app, "init".into(), detail),
    };
    let update = match updater.check().await {
        Ok(Some(update)) => update,
        Ok(None) => {
            clear_pending(&app);
            set_phase(&app, UpdatePhase::UpToDate);
            return;
        }
        Err(e) => {
            let (code, detail) = check_error_text(&e);
            return fail(&app, code, detail);
        }
    };
    if update.version != pending.version {
        // 清单已经翻页：丢掉旧包，等下一轮检查按新版本重新下载。
        clear_pending(&app);
        set_phase(
            &app,
            UpdatePhase::Available { version: update.version.clone(), notes: update.body.clone() },
        );
        return;
    }
    let path = app.state::<UpdateState>().dir.join(&pending.file);
    let bytes = match std::fs::read(&path) {
        Ok(bytes) => bytes,
        Err(e) => {
            clear_pending(&app);
            set_phase(&app, UpdatePhase::Idle);
            return fail(&app, "install".into(), format!("读取更新包失败：{e}"));
        }
    };
    if let Err(e) = update.install(&bytes) {
        return fail(&app, "install".into(), e.to_string());
    }
    // Windows 上走不到这里（install 内部退出）。其它平台装完要重启才生效。
    app.restart();
}

/// 免安装版：新 exe 拷贝 → 旧 exe 改名备份 → 新 exe 就位 → 拉起新进程并退出。
fn apply_portable_update(app: &tauri::AppHandle, pending: &PendingUpdate) -> Result<(), String> {
    let package = app.state::<UpdateState>().dir.join(&pending.file);
    let exe = std::env::current_exe().map_err(|e| format!("取不到当前程序路径：{e}"))?;
    let dir = exe.parent().ok_or_else(|| "取不到程序所在目录".to_string())?;
    let staged = dir.join("bit_pouch.exe.new");
    std::fs::copy(&package, &staged).map_err(|e| format!("准备更新文件失败：{e}"))?;
    let backup = dir.join(format!("bit_pouch.exe.old-{}", env!("CARGO_PKG_VERSION")));
    if let Err(e) = std::fs::rename(&exe, &backup) {
        let _ = std::fs::remove_file(&staged);
        return Err(format!("替换程序失败（备份旧版本）：{e}"));
    }
    if let Err(e) = std::fs::rename(&staged, &exe) {
        let _ = std::fs::rename(&backup, &exe);
        let _ = std::fs::remove_file(&staged);
        return Err(format!("替换程序失败：{e}"));
    }
    clear_pending(app);
    let args: Vec<std::ffi::OsString> = std::env::args_os().skip(1).collect();
    std::process::Command::new(&exe)
        .args(args)
        .spawn()
        .map_err(|e| format!("启动新版本失败：{e}"))?;
    std::process::exit(0);
}

/// 手动安装（设置页「安装」按钮）。
pub fn spawn_install(app: tauri::AppHandle) {
    let Some(pending) = app.state::<UpdateState>().pending() else {
        set_phase(&app, UpdatePhase::Error { code: "no-package".into(), detail: String::new() });
        return;
    };
    install_pending(&app, &pending, false);
}

#[tauri::command]
pub fn get_update_status(state: tauri::State<'_, UpdateState>) -> UpdateStatus {
    state.snapshot()
}

#[tauri::command]
pub fn get_update_settings(state: tauri::State<'_, UpdateState>) -> UpdateSettings {
    state.settings()
}

#[tauri::command]
pub fn set_update_settings(
    app: tauri::AppHandle,
    settings: UpdateSettings,
) -> Result<UpdateSettings, String> {
    let state = app.state::<UpdateState>();
    save_settings(&state.settings_path, &settings)?;
    *state.settings.lock().unwrap() = settings.clone();
    Ok(settings)
}

#[tauri::command]
pub fn check_update(app: tauri::AppHandle) {
    spawn(&app);
}

#[tauri::command]
pub fn download_update(app: tauri::AppHandle) {
    spawn_download(app);
}

#[tauri::command]
pub fn install_update(app: tauri::AppHandle) {
    spawn_install(app);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn busy_only_while_in_flight() {
        assert!(!UpdatePhase::Idle.busy());
        assert!(!UpdatePhase::UpToDate.busy());
        assert!(!UpdatePhase::Available { version: "1".into(), notes: None }.busy());
        assert!(!UpdatePhase::Ready { version: "1".into() }.busy());
        assert!(!UpdatePhase::Error { code: "x".into(), detail: String::new() }.busy());
        assert!(UpdatePhase::Checking.busy());
        assert!(UpdatePhase::Downloading { version: "1".into(), percent: None }.busy());
        assert!(UpdatePhase::Installing { version: "1".into() }.busy());
    }

    #[test]
    fn status_serialization_shape() {
        let status = UpdateStatus {
            current: "0.4.0".into(),
            kind: InstallKind::Portable,
            phase: UpdatePhase::Available {
                version: "0.5.0".into(),
                notes: Some("修了些东西".into()),
            },
        };
        let json = serde_json::to_value(&status).unwrap();
        assert_eq!(json["phase"], "available");
        assert_eq!(json["current"], "0.4.0");
        assert_eq!(json["kind"], "portable");
        assert_eq!(json["version"], "0.5.0");
        assert_eq!(json["notes"], "修了些东西");

        let ready = serde_json::to_value(UpdateStatus {
            current: "0.4.0".into(),
            kind: InstallKind::Installed,
            phase: UpdatePhase::Ready { version: "0.5.0".into() },
        })
        .unwrap();
        assert_eq!(ready["phase"], "ready");
        assert_eq!(ready["version"], "0.5.0");
        assert_eq!(ready["kind"], "installed");
    }

    /// 安装形态判定的铁律：只有 exe 目录与注册表记录的安装目录一致才算安装版。
    #[test]
    fn install_kind_requires_exe_dir_to_match_registered_dir() {
        let installed = Path::new(r"C:\Users\me\AppData\Local\bit_pouch");
        assert_eq!(
            classify_install(Some(installed), Some(installed)),
            InstallKind::Installed
        );
        assert_eq!(
            classify_install(
                Some(Path::new(r"c:\users\ME\appdata\local\bit_pouch\")),
                Some(installed)
            ),
            InstallKind::Installed
        );
        assert_eq!(
            classify_install(Some(Path::new(r"D:\Tools\bit_pouch")), Some(installed)),
            InstallKind::Portable
        );
        assert_eq!(classify_install(Some(installed), None), InstallKind::Portable);
        assert_eq!(classify_install(None, Some(installed)), InstallKind::Portable);
    }

    /// 前端按 `auto_update` / `source` 读写设置，字段名是前后端契约。
    #[test]
    fn settings_serialization_uses_snake_case_fields() {
        let json = serde_json::to_value(UpdateSettings {
            source: UpdateSource::Github,
            auto_update: true,
        })
        .unwrap();
        assert_eq!(json["source"], "github");
        assert_eq!(json["auto_update"], true);
    }

    #[test]
    fn manifest_target_only_portable_on_windows() {
        if cfg!(windows) {
            assert_eq!(
                manifest_target(InstallKind::Portable),
                Some("windows-x86_64-portable")
            );
        } else {
            assert_eq!(manifest_target(InstallKind::Portable), None);
        }
        assert_eq!(manifest_target(InstallKind::Installed), None);
    }

    #[test]
    fn pending_roundtrip_and_invalid_states_are_dropped() {
        let dir = std::env::temp_dir().join(format!("bit-pouch-update-test-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("update-2.0.0.pkg"), b"bytes").unwrap();
        let pending = PendingUpdate {
            version: "2.0.0".into(),
            file: "update-2.0.0.pkg".into(),
            kind: InstallKind::Portable,
        };
        write_pending(&dir, &pending).unwrap();
        assert!(load_pending(&dir, "1.0.0", InstallKind::Portable).is_some());
        assert!(
            load_pending(&dir, "1.0.0", InstallKind::Installed).is_none(),
            "形态不符要丢弃"
        );

        write_pending(&dir, &pending).unwrap();
        std::fs::write(dir.join("update-2.0.0.pkg"), b"bytes").unwrap();
        assert!(
            load_pending(&dir, "2.0.0", InstallKind::Portable).is_none(),
            "已是当前版本要丢弃"
        );

        write_pending(&dir, &pending).unwrap();
        let _ = std::fs::remove_file(dir.join("update-2.0.0.pkg"));
        assert!(
            load_pending(&dir, "1.0.0", InstallKind::Portable).is_none(),
            "包丢了要丢弃"
        );

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn progress_percent_clamps_and_ignores_unknown_total() {
        assert_eq!(progress_percent(500, None), None);
        assert_eq!(progress_percent(500, Some(0)), None);
        assert_eq!(progress_percent(0, Some(1000)), Some(0));
        assert_eq!(progress_percent(250, Some(1000)), Some(25));
        assert_eq!(progress_percent(1000, Some(1000)), Some(100));
        assert_eq!(progress_percent(2000, Some(1000)), Some(100));
        assert_eq!(progress_percent(u64::MAX, Some(u64::MAX)), Some(100));
    }

    #[test]
    fn progress_throttle_only_emits_on_percent_change() {
        let last = AtomicU64::new(u64::MAX);
        assert!(should_emit_progress(&last, 0));
        assert!(!should_emit_progress(&last, 0));
        assert!(!should_emit_progress(&last, 0));
        assert!(should_emit_progress(&last, 1));
        assert!(!should_emit_progress(&last, 1));
        assert!(should_emit_progress(&last, 100));
        assert!(!should_emit_progress(&last, 100));
    }
}
