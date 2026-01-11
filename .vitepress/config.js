import { defineConfig } from 'vitepress'

export default defineConfig({
  srcDir: "docs",
  outDir: "dist",
  base: '/WebAI2API/',
  lang: 'zh-CN',

  title: "WebAI2API",
  description: "网页版 AI 服务转 OpenAI 兼容 API",

  head: [
    ['link', { rel: 'icon', href: '/WebAI2API/favicon.png' }]
  ],

  ignoreDeadLinks: [
    /^http:\/\/localhost/
  ],

  locales: {
    root: {
      label: '简体中文',
      lang: 'zh-CN',
      themeConfig: {
        nav: [
          { text: '首页', link: '/' },
          { text: '入门指南', link: '/guide/requirements' },
          { text: 'API 参考', link: '/api/overview' }
        ],
        sidebar: [
          {
            text: '入门指南',
            items: [
              { text: '项目介绍', link: '/guide/introduction' },
              { text: '环境要求', link: '/guide/requirements' },
              { text: '快速部署', link: '/guide/deployment' },
              { text: '首次使用', link: '/guide/first-use' }
            ]
          },
          {
            text: '配置说明',
            items: [
              { text: '配置概览', link: '/config/overview' },
              { text: '实例配置', link: '/config/instances' },
              { text: '代理设置', link: '/config/proxy' }
            ]
          },
          {
            text: 'API 参考',
            items: [
              { text: '接口概览', link: '/api/overview' },
              { text: 'Chat Completions', link: '/api/chat' },
              { text: 'Models', link: '/api/models' },
              { text: 'Cookies', link: '/api/cookies' }
            ]
          },
          {
            text: '运维管理',
            items: [
              { text: 'Web 管理界面', link: '/admin/webui' },
              { text: 'Linux 部署', link: '/admin/linux' },
              { text: 'Linux 低内存优化', link: '/admin/optimization' },
              { text: '故障排查', link: '/admin/troubleshooting' }
            ]
          }
        ],
        outline: { label: '页面导航' },
        docFooter: { prev: '上一页', next: '下一页' }
      }
    },
    en: {
      label: 'English',
      lang: 'en-US',
      link: '/en/',
      themeConfig: {
        nav: [
          { text: 'Home', link: '/en/' },
          { text: 'Guide', link: '/en/guide/requirements' },
          { text: 'API Reference', link: '/en/api/overview' }
        ],
        sidebar: [
          {
            text: 'Guide',
            items: [
              { text: 'Introduction', link: '/en/guide/introduction' },
              { text: 'Requirements', link: '/en/guide/requirements' },
              { text: 'Deployment', link: '/en/guide/deployment' },
              { text: 'First Use', link: '/en/guide/first-use' }
            ]
          },
          {
            text: 'Configuration',
            items: [
              { text: 'Overview', link: '/en/config/overview' },
              { text: 'Instances', link: '/en/config/instances' },
              { text: 'Proxy Settings', link: '/en/config/proxy' }
            ]
          },
          {
            text: 'API Reference',
            items: [
              { text: 'API Overview', link: '/en/api/overview' },
              { text: 'Chat Completions', link: '/en/api/chat' },
              { text: 'Models', link: '/en/api/models' },
              { text: 'Cookies', link: '/en/api/cookies' }
            ]
          },
          {
            text: 'Operation',
            items: [
              { text: 'Web UI', link: '/en/admin/webui' },
              { text: 'Linux Deployment', link: '/en/admin/linux' },
              { text: 'Linux Optimization', link: '/en/admin/optimization' },
              { text: 'Troubleshooting', link: '/en/admin/troubleshooting' }
            ]
          }
        ],
        outline: { label: 'On this page' },
        docFooter: { prev: 'Previous page', next: 'Next page' }
      }
    }
  },

  themeConfig: {
    socialLinks: [
      { icon: 'github', link: 'https://github.com/foxhui/WebAI2API' }
    ]
  }
})
