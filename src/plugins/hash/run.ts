// 核心由 ihomy 工具箱导出,这里只保留 bit_pouch 运行时的统一入口。
import { run as coreRun } from './core'

export const run = coreRun

export {
  HASH_ALGORITHMS,
  DEFAULT_ALGORITHMS,
  MAX_TEXT_LENGTH,
  MAX_FILE_BYTES,
  bytesToBase64,
  bytesToHex,
  md5,
  crc32,
  isHashAlgorithm,
  digestBytes,
  formatBytes,
  runFile,
} from './core'
