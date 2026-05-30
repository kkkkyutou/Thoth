import { createApp } from 'vue'
import { createPinia } from 'pinia'
import { VueQueryPlugin } from '@tanstack/vue-query'
import router from './router'
import App from './App.vue'
import '@vue-flow/core/dist/style.css'
import '@vue-flow/core/dist/theme-default.css'
import 'uplot/dist/uPlot.min.css'
import './styles/global.css'

const app = createApp(App)
app.use(createPinia())
app.use(VueQueryPlugin)
app.use(router)
app.mount('#app')
