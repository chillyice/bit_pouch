import { createPinia } from 'pinia'
import { createApp } from 'vue'
import App from './App.vue'
import { locale } from './core/i18n'
import { assertRegistry, loadUserPlugins } from './core/registry'
import { applyTheme } from './core/theme'
import router from './router'
import './styles/app.css'

loadUserPlugins()
assertRegistry()
applyTheme()
document.documentElement.lang = locale.value === 'zh' ? 'zh-CN' : 'en'

createApp(App).use(createPinia()).use(router).mount('#app')
