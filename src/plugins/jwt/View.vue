<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { KeyRound, ShieldCheck } from 'lucide-vue-next'
import CopyButton from '@/components/CopyButton.vue'
import ErrorNote from '@/components/ErrorNote.vue'
import Pane from '@/components/Pane.vue'
import SegmentedControl from '@/components/SegmentedControl.vue'
import { locale, t } from '@/core/i18n'
import { callTool } from '@/core/runner'
import type { ToolError } from '@/core/types'
import {
  ASYMMETRIC_ALGS,
  HMAC_ALGS,
  decryptText,
  encryptText,
  generateKeyPair,
  jwkToPem,
  pemToJwk,
  verifyHmac,
  verifyWithKey,
} from './core'

type Tab = 'decode' | 'verify' | 'keys' | 'crypt'

interface TimeClaim {
  key: string
  label: string
  value: number
  iso: string
  status: string
}

interface JwtData {
  header: Record<string, unknown>
  payload: Record<string, unknown>
  times: TimeClaim[]
}

interface KeyPair {
  alg: string
  publicPem: string
  privatePem: string
  publicJwk: string
  privateJwk: string
  fingerprint: string
}

const MESSAGES: Record<string, { zh: string; en: string }> = {
  cryptoUnavailable: { zh: '当前环境不支持该加密操作', en: 'This crypto operation is unavailable here' },
  invalidToken: { zh: '不是有效的 JWT（应为三段）', en: 'Not a valid JWT (expected three segments)' },
  invalidJson: { zh: '令牌内容不是有效 JSON', en: 'The token content is not valid JSON' },
  tokenTooLong: { zh: '令牌过长', en: 'The token is too long' },
  invalidAlg: { zh: '不支持的算法', en: 'Unsupported algorithm' },
  invalidSecret: { zh: '请填写密钥', en: 'Enter the secret' },
  invalidKey: { zh: '密钥格式不正确，需要 PEM 或 JWK', en: 'Invalid key; PEM or JWK required' },
  invalidPassword: { zh: '请填写口令', en: 'Enter a password' },
  badPayload: { zh: '密文格式不正确或口令错误', en: 'Malformed ciphertext or wrong password' },
  empty: { zh: '请粘贴 JWT', en: 'Paste a JWT' },
}

const tab = ref<Tab>('decode')
const token = ref('')
const output = ref('')
const error = ref<ToolError | null>(null)
const data = ref<JwtData | null>(null)
const busy = ref(false)

const verifyAlg = ref(HMAC_ALGS[0])
const secret = ref('')
const publicKey = ref('')
const verifyResult = ref<boolean | null>(null)

const keyAlg = ref(ASYMMETRIC_ALGS[0])
const keyPair = ref<KeyPair | null>(null)
const convertInput = ref('')
const convertAlg = ref(ASYMMETRIC_ALGS[0])
const convertOutput = ref('')

const password = ref('')
const plainInput = ref('')
const cipherInput = ref('')
const cryptOutput = ref('')

const tabOptions = computed(() => [
  { value: 'decode', label: locale.value === 'zh' ? '解码' : 'Decode' },
  { value: 'verify', label: locale.value === 'zh' ? '验签' : 'Verify' },
  { value: 'keys', label: locale.value === 'zh' ? '密钥' : 'Keys' },
  { value: 'crypt', label: locale.value === 'zh' ? '加解密' : 'Encrypt' },
])

const hmacMode = computed(() => HMAC_ALGS.includes(verifyAlg.value))
const headerJson = computed(() => (data.value ? JSON.stringify(data.value.header, null, 2) : ''))
const payloadJson = computed(() => (data.value ? JSON.stringify(data.value.payload, null, 2) : ''))
const keyItems = computed(() => {
  const pair = keyPair.value
  if (!pair) return []
  return [
    { label: 'Public PEM', value: pair.publicPem },
    { label: 'Private PEM', value: pair.privatePem },
    { label: 'Public JWK', value: pair.publicJwk },
    { label: 'Private JWK', value: pair.privateJwk },
  ]
})

function messageOf(err: unknown): string {
  const code = (err as { message?: string })?.message ?? 'cryptoUnavailable'
  return MESSAGES[code]?.[locale.value] ?? code
}

function statusColor(status: string): string {
  if (status === 'expired') return 'var(--red)'
  if (status === 'pending') return 'var(--orange, #f59e0b)'
  return 'var(--accent)'
}

async function decode(): Promise<void> {
  busy.value = true
  const result = await callTool<JwtData>('jwt', token.value, {}, locale.value)
  busy.value = false
  if (result.ok) {
    data.value = result.data ?? null
    output.value = result.output ?? ''
    error.value = null
  } else {
    data.value = null
    output.value = ''
    error.value = result.error ?? { code: 'UNKNOWN', message: t('common.error') }
  }
}

let decodeTimer: ReturnType<typeof setTimeout> | undefined

watch([token, tab], () => {
  if (tab.value !== 'decode') return
  if (decodeTimer) clearTimeout(decodeTimer)
  decodeTimer = setTimeout(() => {
    if (token.value.trim()) decode()
    else {
      data.value = null
      error.value = null
    }
  }, 250)
})

async function verify(): Promise<void> {
  busy.value = true
  error.value = null
  verifyResult.value = null
  try {
    verifyResult.value = hmacMode.value
      ? await verifyHmac(token.value, secret.value, verifyAlg.value)
      : await verifyWithKey(token.value, publicKey.value, verifyAlg.value)
  } catch (err) {
    error.value = { code: 'verifyFailed', message: messageOf(err) }
  } finally {
    busy.value = false
  }
}

async function makeKeys(): Promise<void> {
  busy.value = true
  error.value = null
  try {
    const pair = await generateKeyPair(keyAlg.value)
    keyPair.value = {
      alg: pair.alg,
      publicPem: pair.publicPem,
      privatePem: pair.privatePem,
      publicJwk: JSON.stringify(pair.publicJwk, null, 2),
      privateJwk: JSON.stringify(pair.privateJwk, null, 2),
      fingerprint: pair.fingerprint,
    }
  } catch (err) {
    error.value = { code: 'keyFailed', message: messageOf(err) }
  } finally {
    busy.value = false
  }
}

async function toJwk(): Promise<void> {
  busy.value = true
  error.value = null
  try {
    const jwk = await pemToJwk(convertInput.value, convertAlg.value)
    convertOutput.value = JSON.stringify(jwk, null, 2)
  } catch (err) {
    error.value = { code: 'convertFailed', message: messageOf(err) }
  } finally {
    busy.value = false
  }
}

async function toPem(): Promise<void> {
  busy.value = true
  error.value = null
  try {
    const isPrivate = /"d"\s*:/.test(convertInput.value)
    convertOutput.value = await jwkToPem(convertInput.value, isPrivate ? 'private' : 'public')
  } catch (err) {
    error.value = { code: 'convertFailed', message: messageOf(err) }
  } finally {
    busy.value = false
  }
}

async function encrypt(): Promise<void> {
  busy.value = true
  error.value = null
  try {
    cryptOutput.value = await encryptText(plainInput.value, password.value)
    cipherInput.value = cryptOutput.value
  } catch (err) {
    error.value = { code: 'encryptFailed', message: messageOf(err) }
  } finally {
    busy.value = false
  }
}

async function decrypt(): Promise<void> {
  busy.value = true
  error.value = null
  try {
    cryptOutput.value = await decryptText(cipherInput.value, password.value)
  } catch (err) {
    error.value = { code: 'decryptFailed', message: messageOf(err) }
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <div class="workbench">
    <div class="option-bar">
      <SegmentedControl v-model="tab" :options="tabOptions" />
      <span class="option-spacer" />
      <span class="faint">{{ locale === 'zh' ? '密钥与明文只在内存中，不落盘' : 'Keys and plaintext stay in memory only' }}</span>
    </div>

    <div class="split">
      <Pane :title="locale === 'zh' ? '操作' : 'Input'" :error="Boolean(error)">
        <div style="width: 100%; padding: 16px; display: flex; flex-direction: column; gap: 12px; overflow: auto">
          <template v-if="tab === 'decode' || tab === 'verify'">
            <div class="field">
              <span class="field-label">JWT</span>
              <textarea
                v-model="token"
                class="editor"
                spellcheck="false"
                style="min-height: 120px; border: 1px solid var(--line); border-radius: 8px"
                placeholder="header.payload.signature"
              />
            </div>
            <button v-if="tab === 'decode'" type="button" class="btn btn-primary" :disabled="busy || !token" @click="decode">
              <ShieldCheck :size="14" /> {{ busy ? t('common.loading') : locale === 'zh' ? '解码' : 'Decode' }}
            </button>
          </template>

          <template v-if="tab === 'verify'">
            <div class="option-group">
              <span class="field-label">{{ locale === 'zh' ? '算法' : 'Algorithm' }}</span>
              <select v-model="verifyAlg" class="select" style="width: 120px">
                <optgroup label="HMAC">
                  <option v-for="alg in HMAC_ALGS" :key="alg" :value="alg">{{ alg }}</option>
                </optgroup>
                <optgroup label="RSA / ECDSA">
                  <option v-for="alg in ASYMMETRIC_ALGS" :key="alg" :value="alg">{{ alg }}</option>
                </optgroup>
              </select>
            </div>
            <div v-if="hmacMode" class="field">
              <span class="field-label">{{ locale === 'zh' ? '密钥' : 'Secret' }}</span>
              <input v-model="secret" class="input" type="password" autocomplete="off" />
            </div>
            <div v-else class="field">
              <span class="field-label">{{ locale === 'zh' ? '公钥 (PEM / JWK)' : 'Public key (PEM / JWK)' }}</span>
              <textarea v-model="publicKey" class="editor" spellcheck="false" style="min-height: 120px; border: 1px solid var(--line); border-radius: 8px" />
            </div>
            <button type="button" class="btn btn-primary" :disabled="busy || !token" @click="verify">
              <ShieldCheck :size="14" /> {{ busy ? t('common.loading') : locale === 'zh' ? '验签' : 'Verify' }}
            </button>
            <div v-if="verifyResult !== null" class="result-card" :class="{ highlight: verifyResult }">
              <div class="k">{{ locale === 'zh' ? '结果' : 'Result' }}</div>
              <div class="v big" :style="{ color: verifyResult ? 'var(--accent)' : 'var(--red)' }">
                {{ verifyResult ? (locale === 'zh' ? '签名有效' : 'Signature valid') : locale === 'zh' ? '签名无效' : 'Signature invalid' }}
              </div>
            </div>
          </template>

          <template v-if="tab === 'keys'">
            <div class="option-group">
              <span class="field-label">{{ locale === 'zh' ? '算法' : 'Algorithm' }}</span>
              <select v-model="keyAlg" class="select" style="width: 130px">
                <option v-for="alg in ASYMMETRIC_ALGS" :key="alg" :value="alg">{{ alg }}</option>
              </select>
              <button type="button" class="btn btn-primary btn-sm" :disabled="busy" @click="makeKeys">
                <KeyRound :size="13" /> {{ busy ? t('common.loading') : locale === 'zh' ? '生成密钥对' : 'Generate pair' }}
              </button>
            </div>
            <div class="field">
              <span class="field-label">{{ locale === 'zh' ? 'PEM / JWK 转换' : 'PEM / JWK conversion' }}</span>
              <textarea
                v-model="convertInput"
                class="editor"
                spellcheck="false"
                style="min-height: 110px; border: 1px solid var(--line); border-radius: 8px"
                :placeholder="locale === 'zh' ? '粘贴 PEM 或 JWK' : 'Paste PEM or JWK'"
              />
            </div>
            <div class="option-group">
              <select v-model="convertAlg" class="select" style="width: 120px">
                <option v-for="alg in ASYMMETRIC_ALGS" :key="alg" :value="alg">{{ alg }}</option>
              </select>
              <button type="button" class="btn btn-sm" :disabled="busy" @click="toJwk">PEM → JWK</button>
              <button type="button" class="btn btn-sm" :disabled="busy" @click="toPem">JWK → PEM</button>
            </div>
            <pre v-if="convertOutput" class="output wrap" style="min-height: 0; padding: 10px; border: 1px solid var(--line); border-radius: 8px">{{ convertOutput }}</pre>
          </template>

          <template v-if="tab === 'crypt'">
            <div class="field">
              <span class="field-label">{{ locale === 'zh' ? '口令' : 'Password' }}</span>
              <input v-model="password" class="input" type="password" autocomplete="off" />
            </div>
            <div class="field">
              <span class="field-label">{{ locale === 'zh' ? '明文' : 'Plaintext' }}</span>
              <textarea v-model="plainInput" class="editor" spellcheck="false" style="min-height: 90px; border: 1px solid var(--line); border-radius: 8px" />
            </div>
            <button type="button" class="btn btn-primary btn-sm" style="align-self: flex-start" :disabled="busy || !password" @click="encrypt">
              {{ locale === 'zh' ? '加密' : 'Encrypt' }}
            </button>
            <div class="field">
              <span class="field-label">{{ locale === 'zh' ? '密文' : 'Ciphertext' }}</span>
              <textarea v-model="cipherInput" class="editor" spellcheck="false" style="min-height: 90px; border: 1px solid var(--line); border-radius: 8px" />
            </div>
            <button type="button" class="btn btn-sm" style="align-self: flex-start" :disabled="busy || !password" @click="decrypt">
              {{ locale === 'zh' ? '解密' : 'Decrypt' }}
            </button>
            <pre v-if="cryptOutput" class="output wrap" style="min-height: 0; padding: 10px; border: 1px solid var(--line); border-radius: 8px">{{ cryptOutput }}</pre>
          </template>

          <ErrorNote v-if="error" :error="error" />
        </div>
      </Pane>

      <Pane :title="locale === 'zh' ? '结果' : 'Result'">
        <template v-if="tab === 'decode'">
          <div v-if="data" style="width: 100%; padding: 14px; display: flex; flex-direction: column; gap: 12px; overflow: auto">
            <div style="display: flex; gap: 6px; flex-wrap: wrap">
              <span v-for="item in data.times" :key="item.key" class="badge" :style="{ color: statusColor(item.status), borderColor: 'currentColor' }">
                {{ item.key }}: {{ item.iso }}
              </span>
            </div>
            <div>
              <div class="section-label" style="margin-bottom: 5px">Header</div>
              <pre class="output wrap" style="min-height: 0">{{ headerJson }}</pre>
            </div>
            <div>
              <div class="section-label" style="margin-bottom: 5px">Payload</div>
              <pre class="output wrap" style="min-height: 0">{{ payloadJson }}</pre>
            </div>
          </div>
          <div v-else class="pane-empty">{{ error ? t('common.error') : t('common.empty') }}</div>
        </template>

        <template v-else-if="tab === 'keys'">
          <div v-if="keyPair" style="width: 100%; padding: 14px; display: flex; flex-direction: column; gap: 10px; overflow: auto">
            <div class="binary-line" style="justify-content: space-between">
              <span class="badge accent">{{ keyPair.alg }}</span>
              <span class="mono faint" style="word-break: break-all">{{ keyPair.fingerprint }}</span>
            </div>
            <div v-for="item in keyItems" :key="item.label">
              <div class="binary-line" style="justify-content: space-between; margin-bottom: 4px">
                <span class="section-label">{{ item.label }}</span>
                <CopyButton :text="item.value" icon-only ghost />
              </div>
              <pre class="output wrap" style="min-height: 0; max-height: 16vh; padding: 8px 10px; border: 1px solid var(--line); border-radius: 8px">{{ item.value }}</pre>
            </div>
          </div>
          <div v-else class="pane-empty">{{ t('common.empty') }}</div>
        </template>

        <template v-else>
          <pre v-if="output || cryptOutput" class="output wrap" style="padding: 14px">{{ tab === 'crypt' ? cryptOutput : output }}</pre>
          <div v-else class="pane-empty">{{ error ? t('common.error') : t('common.empty') }}</div>
        </template>
      </Pane>
    </div>
  </div>
</template>
