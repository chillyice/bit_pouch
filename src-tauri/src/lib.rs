#[cfg(desktop)]
use tauri::Manager;

#[cfg(desktop)]
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    #[allow(unused_mut)]
    let mut builder = tauri::Builder::default();

    #[cfg(desktop)]
    {
        // Ctrl+Shift+B: show / hide the palette window from anywhere.
        let toggle = Shortcut::new(Some(Modifiers::CONTROL | Modifiers::SHIFT), Code::KeyB);
        let toggle_for_handler = toggle.clone();

        builder = builder
            .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }))
            .plugin(
                tauri_plugin_global_shortcut::Builder::new()
                    .with_handler(move |app, shortcut, event| {
                        if shortcut != &toggle_for_handler || event.state() != ShortcutState::Pressed {
                            return;
                        }
                        if let Some(window) = app.get_webview_window("main") {
                            if window.is_visible().unwrap_or(false) {
                                let _ = window.hide();
                            } else {
                                let _ = window.show();
                                let _ = window.set_focus();
                            }
                        }
                    })
                    .build(),
            )
            .setup(move |app| {
                app.global_shortcut().register(toggle)?;
                Ok(())
            });
    }

    builder
        .run(tauri::generate_context!())
        .expect("error while running bit_pouch");
}
