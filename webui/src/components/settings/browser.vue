<script setup>
import { onMounted, reactive } from 'vue';
import { useSettingsStore } from '@/stores/settings';

const settingsStore = useSettingsStore();

// 表单数据
const formData = reactive({
    path: '',
    headless: false,
    fission: true,
    // CSS 性能优化
    cssAnimation: false,
    cssFilter: false,
    cssFont: false,
    // 全局代理
    proxyEnable: false,
    proxyType: 'http',
    proxyHost: '127.0.0.1',
    proxyPort: 7890,
    proxyAuth: false,
    proxyUser: '',
    proxyPasswd: ''
});

onMounted(async () => {
    await settingsStore.fetchBrowserConfig();
    const cfg = settingsStore.browserConfig || {};
    formData.path = cfg.path || '';
    formData.headless = cfg.headless || false;
    formData.fission = cfg.fission !== false; // 默认 true

    // CSS 性能优化
    if (cfg.cssInject) {
        formData.cssAnimation = cfg.cssInject.animation || false;
        formData.cssFilter = cfg.cssInject.filter || false;
        formData.cssFont = cfg.cssInject.font || false;
    }

    if (cfg.proxy) {
        formData.proxyEnable = cfg.proxy.enable || false;
        formData.proxyType = cfg.proxy.type || 'http';
        formData.proxyHost = cfg.proxy.host || '';
        formData.proxyPort = cfg.proxy.port || 7890;
        formData.proxyAuth = cfg.proxy.auth || false;
        formData.proxyUser = cfg.proxy.username || '';
        formData.proxyPasswd = cfg.proxy.password || '';
    }
});

// 保存设置
const handleSave = async () => {
    const config = {
        path: formData.path,
        headless: formData.headless,
        cssInject: {
            animation: formData.cssAnimation,
            filter: formData.cssFilter,
            font: formData.cssFont
        },
        fission: formData.fission,
        proxy: {
            enable: formData.proxyEnable,
            type: formData.proxyType,
            host: formData.proxyHost,
            port: formData.proxyPort,
            auth: formData.proxyAuth,
            username: formData.proxyUser,
            password: formData.proxyPasswd
        }
    };
    await settingsStore.saveBrowserConfig(config);
};
</script>

<template>
    <a-layout style="background: transparent;">
        <a-card title="浏览器设置" :bordered="false" style="width: 100%;">
            <a-row :gutter="[16, 16]">
                <!-- 浏览器可执行文件路径 -->
                <a-col :xs="24" :md="24">
                    <div style="margin-bottom: 8px;">
                        <div style="font-weight: 600; margin-bottom: 4px;">浏览器可执行文件路径</div>
                        <div style="font-size: 12px; color: #8c8c8c; margin-bottom: 8px;">
                            留空则使用 Camoufox 默认下载路径<br>
                            Windows示例: C:\camoufox\camoufox.exe<br>
                            Linux示例: /opt/camoufox/camoufox
                        </div>
                        <a-input v-model:value="formData.path" placeholder="留空使用默认路径" />
                    </div>
                </a-col>

                <!-- 无头模式 -->
                <a-col :xs="24" :md="12">
                    <div style="margin-bottom: 8px;">
                        <div style="font-weight: 600; margin-bottom: 4px;">无头模式</div>
                        <div style="font-size: 12px; color: #8c8c8c; margin-bottom: 8px;">
                            启用后浏览器无界面化运行<br>
                            登录模式和 Xvfb 模式会无视该设置强行禁用无头模式
                        </div>
                        <a-switch v-model:checked="formData.headless" />
                        <span style="margin-left: 8px;">
                            {{ formData.headless ? '已启用' : '未启用' }}
                        </span>
                    </div>
                </a-col>

                <!-- 站点隔离 (Fission) -->
                <a-col :xs="24" :md="12">
                    <div style="margin-bottom: 8px;">
                        <div style="font-weight: 600; margin-bottom: 4px;">站点隔离 (fission.autostart)</div>
                        <div style="font-size: 12px; color: #8c8c8c; margin-bottom: 8px;">
                            关闭可低内存占用，适合低配服务器<br>
                            正常 FireFox 用户是默认开启的，请酌情关闭<br>
                            <span style="color: #faad14;">⚠️ 反爬检测可能通过检测单进程或者跨进程延迟来识别自动化特征</span>
                        </div>
                        <a-switch v-model:checked="formData.fission" />
                        <span style="margin-left: 8px;">
                            {{ formData.fission ? '已启用' : '已关闭 (省内存)' }}
                        </span>
                    </div>
                </a-col>
            </a-row>

            <!-- 全局代理设置（折叠面板） -->
            <div style="margin-top: 16px;">
                <a-collapse>
                    <a-collapse-panel key="proxy" header="全局代理设置">
                        <div style="font-size: 12px; color: #8c8c8c; margin-bottom: 16px;">
                            如果实例没有独立配置代理，将使用此全局代理配置
                        </div>

                        <!-- 是否启用代理 -->
                        <div style="margin-bottom: 16px;">
                            <a-switch v-model:checked="formData.proxyEnable" />
                            <span style="margin-left: 8px;">
                                {{ formData.proxyEnable ? '已启用全局代理' : '未启用全局代理' }}
                            </span>
                        </div>

                        <!-- 代理类型 -->
                        <div style="margin-bottom: 16px;" v-if="formData.proxyEnable">
                            <div style="font-weight: 600; margin-bottom: 8px;">代理类型</div>
                            <a-segmented v-model:value="formData.proxyType" block :options="[
                                { label: 'HTTP', value: 'http' },
                                { label: 'SOCKS5', value: 'socks5' }
                            ]" />
                        </div>

                        <a-row :gutter="16" v-if="formData.proxyEnable">
                            <!-- 代理主机 -->
                            <a-col :xs="24" :md="12">
                                <div style="margin-bottom: 16px;">
                                    <div style="font-weight: 600; margin-bottom: 8px;">代理主机</div>
                                    <a-input v-model:value="formData.proxyHost" placeholder="例如: 127.0.0.1" />
                                </div>
                            </a-col>

                            <!-- 代理端口 -->
                            <a-col :xs="24" :md="12">
                                <div style="margin-bottom: 16px;">
                                    <div style="font-weight: 600; margin-bottom: 8px;">代理端口</div>
                                    <a-input-number v-model:value="formData.proxyPort" :min="1" :max="65535"
                                        style="width: 100%" placeholder="例如: 7890" />
                                </div>
                            </a-col>
                        </a-row>

                        <!-- 是否需要验证 -->
                        <div style="margin-bottom: 16px;" v-if="formData.proxyEnable">
                            <div style="font-weight: 600; margin-bottom: 8px;">代理认证</div>
                            <a-switch v-model:checked="formData.proxyAuth" />
                            <span style="margin-left: 8px;">
                                {{ formData.proxyAuth ? '需要认证' : '无需认证' }}
                            </span>
                        </div>

                        <a-row :gutter="16" v-if="formData.proxyEnable && formData.proxyAuth">
                            <!-- 用户名 -->
                            <a-col :xs="24" :md="12">
                                <div style="margin-bottom: 16px;">
                                    <div style="font-weight: 600; margin-bottom: 8px;">用户名</div>
                                    <a-input v-model:value="formData.proxyUser" placeholder="请输入用户名" />
                                </div>
                            </a-col>

                            <!-- 密码 -->
                            <a-col :xs="24" :md="12">
                                <div style="margin-bottom: 16px;">
                                    <div style="font-weight: 600; margin-bottom: 8px;">密码</div>
                                    <a-input-password v-model:value="formData.proxyPasswd" placeholder="请输入密码" />
                                </div>
                            </a-col>
                        </a-row>
                    </a-collapse-panel>

                    <!-- CSS 性能优化 -->
                    <a-collapse-panel key="cssInject" header="CSS 性能优化注入">
                        <a-alert
                            message="⚡ 适用于无 GPU 的服务器环境，通过禁用网页特效来降低 CPU 压力"
                            type="info"
                            show-icon
                            style="margin-bottom: 16px;"
                        />

                        <!-- 禁用动画 -->
                        <div style="margin-bottom: 16px; padding: 12px; background: #fafafa; border-radius: 6px;">
                            <div style="display: flex; align-items: center; justify-content: space-between;">
                                <div>
                                    <div style="font-weight: 600; margin-bottom: 4px;">禁用网页动画</div>
                                    <div style="font-size: 12px; color: #8c8c8c;">
                                        移除 transition 和 animation，显著降低 CPU 持续占用
                                    </div>
                                    <a-tag color="green" style="margin-top: 6px;">风险：极低</a-tag>
                                </div>
                                <a-switch v-model:checked="formData.cssAnimation" />
                            </div>
                        </div>

                        <!-- 禁用滤镜 -->
                        <div style="margin-bottom: 16px; padding: 12px; background: #fafafa; border-radius: 6px;">
                            <div style="display: flex; align-items: center; justify-content: space-between;">
                                <div>
                                    <div style="font-weight: 600; margin-bottom: 4px;">禁用滤镜和阴影</div>
                                    <div style="font-size: 12px; color: #8c8c8c;">
                                        移除 blur(模糊)、box-shadow(阴影) 等复杂渲染
                                    </div>
                                    <a-tag color="orange" style="margin-top: 6px;">风险：中</a-tag>
                                    <span style="font-size: 11px; color: #faad14; margin-left: 8px;">
                                        界面会变丑，少数反爬可能检测样式计算结果
                                    </span>
                                </div>
                                <a-switch v-model:checked="formData.cssFilter" />
                            </div>
                        </div>

                        <!-- 降低字体渲染 -->
                        <div style="padding: 12px; background: #fff2f0; border-radius: 6px; border: 1px solid #ffccc7;">
                            <div style="display: flex; align-items: center; justify-content: space-between;">
                                <div>
                                    <div style="font-weight: 600; margin-bottom: 4px;">降低字体渲染质量</div>
                                    <div style="font-size: 12px; color: #8c8c8c;">
                                        强制使用极速渲染模式，微量减少 CPU 绘图压力
                                    </div>
                                    <a-tag color="red" style="margin-top: 6px;">⚠️ 风险：高</a-tag>
                                    <div style="font-size: 11px; color: #cf1322; margin-top: 4px;">
                                        会导致文字边缘有锯齿，且可能导致字体指纹与标准浏览器不符，易被高级反爬识别
                                    </div>
                                </div>
                                <a-switch v-model:checked="formData.cssFont" />
                            </div>
                        </div>
                    </a-collapse-panel>
                </a-collapse>
            </div>

            <!-- 保存按钮（右下角） -->
            <div style="display: flex; justify-content: flex-end; margin-top: 24px;">
                <a-button type="primary" @click="handleSave">
                    保存设置
                </a-button>
            </div>
        </a-card>
    </a-layout>
</template>
