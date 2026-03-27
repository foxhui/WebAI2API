<script setup>
import { ref, onMounted, computed } from 'vue';
import { useSettingsStore } from '@/stores/settings';
import { Modal } from 'ant-design-vue';

const settingsStore = useSettingsStore();

const poolConfig = computed({
    get: () => settingsStore.poolConfig,
    set: (val) => settingsStore.poolConfig = val
});

const handleSavePool = async () => {
    await settingsStore.savePoolConfig(poolConfig.value);
};

// 获取初始数据
onMounted(async () => {
    await Promise.all([
        settingsStore.fetchWorkerConfig(),
        settingsStore.fetchPoolConfig(),
        settingsStore.fetchAdaptersMeta()
    ]);
});

// 计算属性：适配器选项（包含 merge）
const adapterOptions = computed(() => {
    const options = settingsStore.adaptersMeta.map(a => ({
        label: a.displayName || a.id,
        value: a.id
    }));
    // 将 Merge 选项放在第一个位置
    if (!options.find(o => o.value === 'merge')) {
        options.unshift({ label: 'Merge（聚合模式）', value: 'merge' });
    }
    return options;
});

// 计算属性：可聚合的适配器选项（不包含 merge，避免套娃）
const mergeableAdapterOptions = computed(() => {
    return settingsStore.adaptersMeta
        .filter(a => a.id !== 'merge')
        .map(a => ({
            label: a.displayName || a.id,
            value: a.id
        }));
});

// 辅助函数：根据适配器 ID 获取 displayName
const getAdapterDisplayName = (id) => {
    if (id === 'merge') return 'Merge（聚合模式）';
    const adapter = settingsStore.adaptersMeta.find(a => a.id === id);
    return adapter?.displayName || id;
};

// 实例列表表格列定义
const columns = [
    {
        title: '实例名称',
        dataIndex: 'name',
        key: 'name',
    },
    {
        title: 'Worker 数量',
        dataIndex: 'workerCount',
        key: 'workerCount',
    },
    {
        title: '代理',
        dataIndex: 'proxy',
        key: 'proxy',
    },
    {
        title: '数据标记',
        key: 'userDataMark',
        dataIndex: 'userDataMark',
    },
    {
        title: '操作',
        key: 'action',
    },
];

// 实例列表数据 (从 Store 获取)
const instanceData = computed({
    get: () => settingsStore.workerConfig,
    set: (val) => { settingsStore.workerConfig = val; }
});

// 批量选择
const selectedRowKeys = ref([]);
const rowSelection = computed(() => ({
    selectedRowKeys: selectedRowKeys.value,
    onChange: (keys) => { selectedRowKeys.value = keys; }
}));

// 批量代理设置
const batchProxyVisible = ref(false);
const batchProxyForm = ref({
    proxy: true,
    proxyType: 'socks5',
    proxyHost: '',
    proxyPort: 1080,
    proxyAuth: false,
    proxyUsername: '',
    proxyPassword: ''
});

const openBatchProxy = () => {
    batchProxyForm.value = {
        proxy: true,
        proxyType: 'socks5',
        proxyHost: '',
        proxyPort: 1080,
        proxyAuth: false,
        proxyUsername: '',
        proxyPassword: ''
    };
    batchProxyVisible.value = true;
};

const handleBatchProxySave = async () => {
    const newList = (instanceData.value || []).map(inst => {
        if (!selectedRowKeys.value.includes(inst.name)) return inst;
        return {
            ...inst,
            proxy: batchProxyForm.value.proxy ? {
                enable: true,
                type: batchProxyForm.value.proxyType,
                host: batchProxyForm.value.proxyHost,
                port: batchProxyForm.value.proxyPort,
                auth: batchProxyForm.value.proxyAuth,
                username: batchProxyForm.value.proxyUsername,
                password: batchProxyForm.value.proxyPassword
            } : null
        };
    });
    const success = await settingsStore.saveWorkerConfig(newList);
    if (success) {
        batchProxyVisible.value = false;
        selectedRowKeys.value = [];
    }
};

// 批量删除
const handleBatchDelete = () => {
    Modal.confirm({
        title: '批量删除实例',
        content: `确定要删除选中的 ${selectedRowKeys.value.length} 个实例吗？此操作不可撤销。`,
        okText: '删除',
        okType: 'danger',
        cancelText: '取消',
        async onOk() {
            const newList = (instanceData.value || []).filter(
                inst => !selectedRowKeys.value.includes(inst.name)
            );
            const success = await settingsStore.saveWorkerConfig(newList);
            if (success) {
                selectedRowKeys.value = [];
            }
        }
    });
};

// 抽屉状态
const drawerOpen = ref(false);
const editingInstance = ref(null);

// 编辑表单数据
const editForm = ref({
    name: '',
    userDataMark: '',
    proxy: false,
    proxyType: 'socks5',
    proxyHost: '',
    proxyPort: 1080,
    proxyAuth: false,
    proxyUsername: '',
    proxyPassword: '',
    workers: []
});

// 创建实例
const handleCreateInstance = () => {
    editingInstance.value = null; // null表示创建新实例
    const randomSuffix = Math.random().toString(36).substring(2, 7);
    // 重置表单为默认值
    editForm.value = {
        name: `instance-${(instanceData.value || []).length + 1}-${randomSuffix}`,
        userDataMark: '',
        proxy: false,
        proxyType: 'socks5',
        proxyHost: '',
        proxyPort: 1080,
        proxyAuth: false,
        proxyUsername: '',
        proxyPassword: '',
        workers: []
    };
    drawerOpen.value = true;
};

// 编辑实例
const handleEdit = (record) => {
    editingInstance.value = record;
    // 填充表单数据
    editForm.value = {
        name: record.name,
        userDataMark: record.userDataMark || '',
        proxy: record.proxy ? true : false,
        proxyType: record.proxy?.type || 'socks5',
        proxyHost: record.proxy?.host || '',
        proxyPort: record.proxy?.port || 1080,
        proxyAuth: record.proxy?.auth || false,
        proxyUsername: record.proxy?.username || '',
        proxyPassword: record.proxy?.password || '',
        workers: record.workers ? [...record.workers] : []
    };
    // 兼容前端展示用的 proxy 布尔值
    if (record.proxy === null || record.proxy === undefined) {
        editForm.value.proxy = false;
    }
    drawerOpen.value = true;
};

// 删除实例
const handleDelete = async (record) => {
    const newList = instanceData.value.filter(item => item.name !== record.name);
    await settingsStore.saveWorkerConfig(newList);
};

// 保存编辑
const handleSaveEdit = async () => {
    // 构建要保存的对象结构
    const instanceToSave = {
        name: editForm.value.name,
        userDataMark: editForm.value.userDataMark,
        workers: editForm.value.workers,
        // 如果启用了代理，则构建代理对象，否则为 null
        proxy: editForm.value.proxy ? {
            enable: true,
            type: editForm.value.proxyType,
            host: editForm.value.proxyHost,
            port: editForm.value.proxyPort,
            auth: editForm.value.proxyAuth,
            username: editForm.value.proxyUsername,
            password: editForm.value.proxyPassword
        } : null
    };

    let newList = [...(instanceData.value || [])];
    if (editingInstance.value === null) {
        // 创建
        newList.push(instanceToSave);
    } else {
        // 更新 - 用原始 name 查找
        const index = newList.findIndex(item => item.name === editingInstance.value.name);
        if (index > -1) {
            newList[index] = instanceToSave;
        }
    }

    const success = await settingsStore.saveWorkerConfig(newList);
    if (success) {
        drawerOpen.value = false;
    }
};

// 编辑中的Worker索引
const editingWorkerIndex = ref(-1);
const workerFormVisible = ref(false);
const workerForm = ref({
    name: '',
    type: 'lmarena',
    mergeTypes: [],
    mergeMonitor: ''
});

// 添加Worker
const handleAddWorker = () => {
    editingWorkerIndex.value = -1;
    const randomSuffix = Math.random().toString(36).substring(2, 7);
    workerForm.value = {
        name: `worker-${editForm.value.workers.length + 1}-${randomSuffix}`,
        type: 'lmarena',
        mergeTypes: [],
        mergeMonitor: ''
    };
    workerFormVisible.value = true;
};

// 编辑Worker
const handleEditWorker = (index) => {
    editingWorkerIndex.value = index;
    const worker = editForm.value.workers[index];
    workerForm.value = {
        name: worker.name,
        type: worker.type,
        mergeTypes: worker.mergeTypes ? [...worker.mergeTypes] : [],
        mergeMonitor: worker.mergeMonitor || ''
    };
    workerFormVisible.value = true;
};

// 保存Worker配置
const handleSaveWorker = () => {
    if (editingWorkerIndex.value === -1) {
        // 新增
        editForm.value.workers.push({ ...workerForm.value });
    } else {
        // 编辑
        editForm.value.workers[editingWorkerIndex.value] = { ...workerForm.value };
    }
    workerFormVisible.value = false;
};

// 删除Worker
const handleRemoveWorker = (index) => {
    editForm.value.workers.splice(index, 1);
};
</script>

<template>
    <a-layout style="background: transparent;">
        <a-card title="负载均衡" :bordered="false" style="width: 100%; margin-bottom: 10px;">
            <!-- 调度策略 -->
            <div style="margin-bottom: 24px;">
                <div style="font-weight: 600; margin-bottom: 8px;">调度策略</div>
                <div style="font-size: 12px; color: #8c8c8c; margin-bottom: 12px;">
                    选择任务分配到工作实例的调度算法
                </div>
                <a-segmented v-model:value="poolConfig.strategy" block :options="[
                    { label: '最少繁忙', value: 'least_busy' },
                    { label: '轮询', value: 'round_robin' },
                    { label: '随机', value: 'random' }
                ]" />
            </div>

            <!-- 生成等待超时 -->
            <div style="margin-bottom: 24px;">
                <div style="font-weight: 600; margin-bottom: 8px;">生成等待超时</div>
                <div style="font-size: 12px; color: #8c8c8c; margin-bottom: 12px;">
                    等待 AI 生成结果的最长时间，单位：秒（默认 120 秒）
                </div>
                <a-input-number v-model:value="poolConfig.waitTimeout" :min="30" :max="3600" :step="30"
                    style="width: 100%" placeholder="请输入超时秒数">
                    <template #addonAfter>秒</template>
                </a-input-number>
            </div>

            <!-- 故障转移（折叠面板） -->
            <div style="margin-bottom: 24px;">
                <a-collapse>
                    <a-collapse-panel key="failover" header="故障转移">
                        <a-row :gutter="16">
                            <a-col :xs="24" :md="12">
                                <div style="margin-bottom: 8px;">
                                    <div style="font-weight: 600; margin-bottom: 8px;">启用故障转移</div>
                                    <div style="font-size: 12px; color: #8c8c8c; margin-bottom: 12px;">
                                        启用后，任务失败时会自动切换到其他可用实例重试
                                    </div>
                                    <a-switch v-model:checked="poolConfig.failover.enabled" />
                                </div>
                            </a-col>

                            <a-col :xs="24" :md="12">
                                <div style="margin-bottom: 8px;">
                                    <div style="font-weight: 600; margin-bottom: 8px;">重试次数</div>
                                    <div style="font-size: 12px; color: #8c8c8c; margin-bottom: 12px;">
                                        故障转移时最大重试次数，范围 1-10
                                    </div>
                                    <a-input-number v-model:value="poolConfig.failover.maxRetries" :min="1" :max="10"
                                        :disabled="!poolConfig.failover.enabled" style="width: 100%" placeholder="请输入重试次数" />
                                </div>
                            </a-col>
                        </a-row>
                    </a-collapse-panel>
                </a-collapse>
            </div>

            <!-- 保存按钮 -->
            <div style="display: flex; justify-content: flex-end; margin-top: 24px;">
                <a-button type="primary" @click="handleSavePool">
                    保存设置
                </a-button>
            </div>
        </a-card>


        <a-card :bordered="false" style="width: 100%;">
            <!-- 卡片标题和创建按钮 -->
            <template #title>
                <div style="display: flex; justify-content: space-between; align-items: center;">
                    <span>实例列表</span>
                    <a-space>
                        <a-button v-if="selectedRowKeys.length > 0" @click="openBatchProxy">
                            批量设置代理 ({{ selectedRowKeys.length }})
                        </a-button>
                        <a-button v-if="selectedRowKeys.length > 0" danger @click="handleBatchDelete">
                            批量删除 ({{ selectedRowKeys.length }})
                        </a-button>
                        <a-button type="primary" @click="handleCreateInstance">
                            创建实例
                        </a-button>
                    </a-space>
                </div>
            </template>

            <!-- 实例表格 -->
            <a-table :columns="columns" :data-source="instanceData" :pagination="false"
                :row-selection="rowSelection" row-key="name">
                <template #bodyCell="{ column, record }">
                    <!-- 实例名称 -->
                    <template v-if="column.key === 'name'">
                        <a>{{ record.name }}</a>
                    </template>

                    <!-- Worker 数量 -->
                    <template v-else-if="column.key === 'workerCount'">
                        {{ record.workers ? record.workers.length : 0 }}
                    </template>

                    <!-- 代理状态 -->
                    <template v-else-if="column.key === 'proxy'">
                        <a-tag :color="record.proxy ? 'green' : 'default'">
                            {{ record.proxy ? '已启用' : '未启用' }}
                        </a-tag>
                    </template>

                    <!-- 操作列 -->
                    <template v-else-if="column.key === 'action'">
                        <span>
                            <a @click="handleEdit(record)">编辑</a>
                            <a-divider type="vertical" />
                            <a style="color: #ff4d4f" @click="handleDelete(record)">删除</a>
                        </span>
                    </template>
                </template>
            </a-table>
        </a-card>

        <!-- 编辑/创建抽屉 -->
        <a-drawer v-model:open="drawerOpen"
            :title="editingInstance === null ? '创建实例' : `编辑实例 - ${editingInstance.name}`" placement="right" width="500">
            <div style="margin-bottom: 24px;">
                <!-- 实例名称 -->
                <div style="margin-bottom: 16px;">
                    <div style="font-weight: 600; margin-bottom: 4px;">实例名称</div>
                    <div style="font-size: 12px; color: #ff4d4f; margin-bottom: 8px;">
                        * 名称必须全局唯一，不可重复
                    </div>
                    <a-input v-model:value="editForm.name" placeholder="请输入实例名称" />
                </div>

                <!-- 数据标记 -->
                <div style="margin-bottom: 16px;">
                    <div style="font-weight: 600; margin-bottom: 4px;">数据标记</div>
                    <div style="font-size: 12px; color: #8c8c8c; margin-bottom: 8px;">
                        用于区分实例数据存储的文件夹名称 (userDataMark)
                    </div>
                    <a-input v-model:value="editForm.userDataMark" placeholder="请输入数据标记，如: main-gemini" />
                </div>

                <!-- 代理设置（折叠面板） -->
                <div style="margin-bottom: 16px;">
                    <a-collapse>
                        <a-collapse-panel key="proxy" header="代理设置">
                            <!-- 是否启用代理 -->
                            <div style="margin-bottom: 16px;">
                                <a-switch v-model:checked="editForm.proxy" />
                                <span style="margin-left: 8px;">
                                    {{ editForm.proxy ? '已启用代理' : '未启用代理' }}
                                </span>
                            </div>

                            <!-- 代理类型 -->
                            <div style="margin-bottom: 16px;" v-if="editForm.proxy">
                                <div style="font-weight: 600; margin-bottom: 8px;">代理类型</div>
                                <a-segmented v-model:value="editForm.proxyType" block :options="[
                                    { label: 'SOCKS5', value: 'socks5' },
                                    { label: 'HTTP', value: 'http' }
                                ]" style="width: 100%" />
                            </div>

                            <!-- 服务器地址 -->
                            <div style="margin-bottom: 16px;" v-if="editForm.proxy">
                                <div style="font-weight: 600; margin-bottom: 8px;">服务器地址</div>
                                <a-input v-model:value="editForm.proxyHost" placeholder="例如: 127.0.0.1" />
                            </div>

                            <!-- 端口 -->
                            <div style="margin-bottom: 16px;" v-if="editForm.proxy">
                                <div style="font-weight: 600; margin-bottom: 8px;">端口</div>
                                <a-input-number v-model:value="editForm.proxyPort" :min="1" :max="65535"
                                    style="width: 100%" placeholder="例如: 1080" />
                            </div>

                            <!-- 是否需要验证 -->
                            <div style="margin-bottom: 16px;" v-if="editForm.proxy">
                                <div style="font-weight: 600; margin-bottom: 8px;">身份验证</div>
                                <a-switch v-model:checked="editForm.proxyAuth" />
                                <span style="margin-left: 8px;">
                                    {{ editForm.proxyAuth ? '需要验证' : '无需验证' }}
                                </span>
                            </div>

                            <!-- 用户名 -->
                            <div style="margin-bottom: 16px;" v-if="editForm.proxy && editForm.proxyAuth">
                                <div style="font-weight: 600; margin-bottom: 8px;">用户名</div>
                                <a-input v-model:value="editForm.proxyUsername" placeholder="请输入用户名" />
                            </div>

                            <!-- 密码 -->
                            <div style="margin-bottom: 16px;" v-if="editForm.proxy && editForm.proxyAuth">
                                <div style="font-weight: 600; margin-bottom: 8px;">密码</div>
                                <a-input-password v-model:value="editForm.proxyPassword" placeholder="请输入密码" />
                            </div>
                        </a-collapse-panel>
                    </a-collapse>
                </div>

                <!-- Worker 列表 -->
                <div>
                    <div
                        style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
                        <div style="font-weight: 600;">Worker 列表</div>
                        <a-button size="small" type="primary" @click="handleAddWorker">
                            添加 Worker
                        </a-button>
                    </div>
                    <a-list bordered :data-source="editForm.workers" style="margin-top: 8px;">
                        <template #renderItem="{ item, index }">
                            <a-list-item>
                                <template #actions>
                                    <a @click="handleEditWorker(index)">编辑</a>
                                    <a style="color: #ff4d4f" @click="handleRemoveWorker(index)">删除</a>
                                </template>
                                <div>
                                    <div style="font-weight: 600;">{{ item.name }}</div>
                                    <div style="font-size: 12px; color: #8c8c8c;">
                                        类型: {{ getAdapterDisplayName(item.type) }}
                                        <span v-if="item.type === 'merge'">
                                            | 聚合: {{ item.mergeTypes?.map(getAdapterDisplayName).join(', ') || '无' }}
                                            <span v-if="item.mergeMonitor">
                                                | 监控: {{ getAdapterDisplayName(item.mergeMonitor) }}
                                            </span>
                                        </span>
                                    </div>
                                </div>
                            </a-list-item>
                        </template>
                    </a-list>
                </div>
            </div>

            <!-- 抽屉底部保存按钮 -->
            <template #footer>
                <div style="text-align: right;">
                    <a-button style="margin-right: 8px" @click="drawerOpen = false">取消</a-button>
                    <a-button type="primary" @click="handleSaveEdit">保存</a-button>
                </div>
            </template>
        </a-drawer>

        <!-- Worker配置模态框 -->
        <a-modal v-model:open="workerFormVisible" :title="editingWorkerIndex === -1 ? '添加 Worker' : '编辑 Worker'"
            okText="确定" cancelText="取消" @ok="handleSaveWorker">
            <div style="margin-bottom: 16px;">
                <div style="font-weight: 600; margin-bottom: 4px;">Worker 名称</div>
                <div style="font-size: 12px; color: #ff4d4f; margin-bottom: 8px;">
                    * 名称必须全局唯一，不可重复
                </div>
                <a-input v-model:value="workerForm.name" placeholder="例如: default" />
            </div>

            <div style="margin-bottom: 16px;">
                <div style="font-weight: 600; margin-bottom: 8px;">适配器类型</div>
                <a-select v-model:value="workerForm.type" style="width: 100%" :options="adapterOptions" />
            </div>

            <!-- Merge 模式额外配置 -->
            <template v-if="workerForm.type === 'merge'">
                <div style="margin-bottom: 16px;">
                    <div style="font-weight: 600; margin-bottom: 4px;">聚合类型</div>
                    <div style="font-size: 12px; color: #8c8c8c; margin-bottom: 8px;">
                        选择要聚合的后端适配器（可多选）
                    </div>
                    <a-select v-model:value="workerForm.mergeTypes" mode="multiple" style="width: 100%"
                        placeholder="选择要聚合的适配器" :options="mergeableAdapterOptions">
                    </a-select>
                </div>

                <div style="margin-bottom: 16px;">
                    <div style="font-weight: 600; margin-bottom: 4px;">空闲监控后端</div>
                    <div style="font-size: 12px; color: #8c8c8c; margin-bottom: 8px;">
                        空闲时挂机监控的后端（可选）
                    </div>
                    <a-select v-model:value="workerForm.mergeMonitor" style="width: 100%" placeholder="选择监控后端（可留空）"
                        allow-clear>
                        <a-select-option value="">无</a-select-option>
                        <a-select-option v-for="type in workerForm.mergeTypes" :key="type" :value="type">
                            {{ getAdapterDisplayName(type) }}
                        </a-select-option>
                    </a-select>
                </div>
            </template>
        </a-modal>

        <!-- 批量代理设置模态框 -->
        <a-modal v-model:open="batchProxyVisible" title="批量设置代理" okText="确定" cancelText="取消"
            @ok="handleBatchProxySave">
            <div style="margin-bottom: 16px;">
                <a-switch v-model:checked="batchProxyForm.proxy" />
                <span style="margin-left: 8px;">
                    {{ batchProxyForm.proxy ? '启用代理' : '禁用代理' }}
                </span>
            </div>

            <template v-if="batchProxyForm.proxy">
                <div style="margin-bottom: 16px;">
                    <div style="font-weight: 600; margin-bottom: 8px;">代理类型</div>
                    <a-segmented v-model:value="batchProxyForm.proxyType" block :options="[
                        { label: 'SOCKS5', value: 'socks5' },
                        { label: 'HTTP', value: 'http' }
                    ]" style="width: 100%" />
                </div>

                <div style="margin-bottom: 16px;">
                    <div style="font-weight: 600; margin-bottom: 8px;">服务器地址</div>
                    <a-input v-model:value="batchProxyForm.proxyHost" placeholder="例如: 127.0.0.1" />
                </div>

                <div style="margin-bottom: 16px;">
                    <div style="font-weight: 600; margin-bottom: 8px;">端口</div>
                    <a-input-number v-model:value="batchProxyForm.proxyPort" :min="1" :max="65535"
                        style="width: 100%" placeholder="例如: 1080" />
                </div>

                <div style="margin-bottom: 16px;">
                    <div style="font-weight: 600; margin-bottom: 8px;">身份验证</div>
                    <a-switch v-model:checked="batchProxyForm.proxyAuth" />
                    <span style="margin-left: 8px;">
                        {{ batchProxyForm.proxyAuth ? '需要验证' : '无需验证' }}
                    </span>
                </div>

                <div style="margin-bottom: 16px;" v-if="batchProxyForm.proxyAuth">
                    <div style="font-weight: 600; margin-bottom: 8px;">用户名</div>
                    <a-input v-model:value="batchProxyForm.proxyUsername" placeholder="请输入用户名" />
                </div>

                <div style="margin-bottom: 16px;" v-if="batchProxyForm.proxyAuth">
                    <div style="font-weight: 600; margin-bottom: 8px;">密码</div>
                    <a-input-password v-model:value="batchProxyForm.proxyPassword" placeholder="请输入密码" />
                </div>
            </template>
        </a-modal>
    </a-layout>
</template>
