<script setup>
import { onMounted, reactive } from 'vue';
import { useSettingsStore } from '@/stores/settings';

const settingsStore = useSettingsStore();

// 表单数据
const formData = reactive({
    path: '',
    headless: false,
    fission: true,
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
                            启用后浏览器无界面化运行（登录模式和 Xvfb 模式会强行禁用）
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
                        <div style="font-weight: 600; margin-bottom: 4px;">站点隔离 (Fission)</div>
                        <div style="font-size: 12px; color: #8c8c8c; margin-bottom: 8px;">
                            关闭可低内存占用，适合低配服务器<br>
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
