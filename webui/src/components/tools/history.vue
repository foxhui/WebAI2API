<script setup>
import { ref, onMounted, watch } from 'vue';
import { useSettingsStore } from '@/stores/settings';
import {
    ReloadOutlined,
    DeleteOutlined,
    DownloadOutlined,
    EyeOutlined,
    CheckCircleOutlined,
    CloseCircleOutlined,
    ClockCircleOutlined,
    PictureOutlined,
    PlayCircleOutlined,
    FileTextOutlined
} from '@ant-design/icons-vue';
import { message, Modal } from 'ant-design-vue';

const settingsStore = useSettingsStore();

// 数据状态
const loading = ref(false);
const records = ref([]);
const total = ref(0);
const page = ref(1);
const pageSize = ref(20);

// 筛选状态
const dateRange = ref([]);
const statusFilter = ref('all');
const modelFilter = ref('');
const searchText = ref('');
const modelOptions = ref([]);

// 统计摘要
const stats = ref({ total: 0, success: 0, failed: 0, avgDuration: 0 });

// 详情抽屉
const drawerVisible = ref(false);
const currentRecord = ref(null);
const detailLoading = ref(false);

// 媒体数据缓存 (blob URLs)
const mediaCache = ref({});

// 状态配置
const statusConfig = {
    success: { color: '#52c41a', text: '成功', icon: CheckCircleOutlined },
    failed: { color: '#ff4d4f', text: '失败', icon: CloseCircleOutlined },
    pending: { color: '#faad14', text: '处理中', icon: ClockCircleOutlined }
};

// 获取历史列表
const fetchHistory = async () => {
    loading.value = true;
    try {
        const params = new URLSearchParams({
            page: page.value,
            pageSize: pageSize.value
        });

        if (statusFilter.value && statusFilter.value !== 'all') {
            params.append('status', statusFilter.value);
        }
        if (modelFilter.value) {
            params.append('model', modelFilter.value);
        }
        if (searchText.value) {
            params.append('search', searchText.value);
        }
        if (dateRange.value && dateRange.value.length === 2) {
            params.append('startDate', dateRange.value[0].format('YYYY-MM-DD'));
            params.append('endDate', dateRange.value[1].format('YYYY-MM-DD'));
        }

        const res = await fetch(`/admin/history?${params.toString()}`, {
            headers: settingsStore.getHeaders()
        });
        if (res.ok) {
            const data = await res.json();
            records.value = data.items || [];
            total.value = data.total || 0;
            // 预加载缩略图
            preloadThumbnails();
        }
    } catch (e) {
        message.error('获取历史记录失败');
    } finally {
        loading.value = false;
    }
};

// 预加载列表中的缩略图
const preloadThumbnails = async () => {
    for (const record of records.value) {
        if (record.responseMedia && record.responseMedia.length > 0) {
            const media = record.responseMedia[0];
            if (media.localPath && media.status === 'downloaded') {
                await getMediaBlobUrl(media);
            }
        }
    }
};

// 获取统计摘要
const fetchStats = async () => {
    try {
        const params = new URLSearchParams();
        if (dateRange.value && dateRange.value.length === 2) {
            params.append('startDate', dateRange.value[0].format('YYYY-MM-DD'));
            params.append('endDate', dateRange.value[1].format('YYYY-MM-DD'));
        }

        const res = await fetch(`/admin/history/stats?${params.toString()}`, {
            headers: settingsStore.getHeaders()
        });
        if (res.ok) {
            stats.value = await res.json();
        }
    } catch (e) {
        console.error('获取统计失败', e);
    }
};

// 获取模型列表
const fetchModels = async () => {
    try {
        const res = await fetch('/admin/history/models', {
            headers: settingsStore.getHeaders()
        });
        if (res.ok) {
            modelOptions.value = await res.json();
        }
    } catch (e) {
        console.error('获取模型列表失败', e);
    }
};

// 查看详情
const viewDetail = async (record) => {
    drawerVisible.value = true;
    detailLoading.value = true;
    try {
        const res = await fetch(`/admin/history/${record.id}`, {
            headers: settingsStore.getHeaders()
        });
        if (res.ok) {
            currentRecord.value = await res.json();
            // 预加载详情中的媒体
            if (currentRecord.value.responseMedia) {
                for (const media of currentRecord.value.responseMedia) {
                    if (media.localPath && media.status === 'downloaded') {
                        await getMediaBlobUrl(media);
                    }
                }
            }
        }
    } catch (e) {
        message.error('获取详情失败');
    } finally {
        detailLoading.value = false;
    }
};

// 获取媒体 Blob URL（带认证）
const getMediaBlobUrl = async (media) => {
    if (!media.localPath) return null;

    const filename = media.localPath.split('/').pop();
    const cacheKey = filename;

    // 检查缓存
    if (mediaCache.value[cacheKey]) {
        return mediaCache.value[cacheKey];
    }

    try {
        const res = await fetch(`/admin/history/media/${filename}`, {
            headers: settingsStore.getHeaders()
        });
        if (res.ok) {
            const blob = await res.blob();
            const blobUrl = URL.createObjectURL(blob);
            mediaCache.value[cacheKey] = blobUrl;
            return blobUrl;
        }
    } catch (e) {
        console.error('获取媒体失败', e);
    }
    return null;
};

// 获取缓存的 blob URL
const getCachedMediaUrl = (media) => {
    if (!media || !media.localPath) return null;
    const filename = media.localPath.split('/').pop();
    return mediaCache.value[filename] || null;
};

// 重试下载媒体
const retryMedia = async (recordId, mediaIndex) => {
    try {
        const res = await fetch(`/admin/history/${recordId}/retry-media`, {
            method: 'POST',
            headers: {
                ...settingsStore.getHeaders(),
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ mediaIndex })
        });

        if (res.ok) {
            message.success('下载成功');
            fetchHistory();
            if (currentRecord.value && currentRecord.value.id === recordId) {
                viewDetail(currentRecord.value);
            }
        } else {
            const data = await res.json();
            message.error(data.message || '下载失败');
        }
    } catch (e) {
        message.error('请求失败');
    }
};

// 删除记录
const deleteRecords = (ids) => {
    Modal.confirm({
        title: '确认删除',
        content: `确定要删除这 ${ids.length} 条记录吗？关联的媒体文件也会被删除。`,
        okText: '删除',
        okType: 'danger',
        cancelText: '取消',
        async onOk() {
            try {
                const res = await fetch('/admin/history', {
                    method: 'DELETE',
                    headers: {
                        ...settingsStore.getHeaders(),
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({ ids })
                });
                if (res.ok) {
                    message.success('删除成功');
                    fetchHistory();
                    fetchStats();
                } else {
                    message.error('删除失败');
                }
            } catch (e) {
                message.error('请求失败');
            }
        }
    });
};

// 按日期范围删除
const deleteByDateRange = () => {
    if (!dateRange.value || dateRange.value.length !== 2) {
        message.warning('请先选择日期范围');
        return;
    }

    Modal.confirm({
        title: '确认删除',
        content: `确定要删除 ${dateRange.value[0].format('YYYY-MM-DD')} 至 ${dateRange.value[1].format('YYYY-MM-DD')} 的所有记录吗？`,
        okText: '删除',
        okType: 'danger',
        cancelText: '取消',
        async onOk() {
            try {
                const params = new URLSearchParams({
                    startDate: dateRange.value[0].format('YYYY-MM-DD'),
                    endDate: dateRange.value[1].format('YYYY-MM-DD')
                });
                const res = await fetch(`/admin/history?${params.toString()}`, {
                    method: 'DELETE',
                    headers: settingsStore.getHeaders()
                });
                if (res.ok) {
                    const data = await res.json();
                    message.success(`已删除 ${data.deleted} 条记录`);
                    fetchHistory();
                    fetchStats();
                } else {
                    message.error('删除失败');
                }
            } catch (e) {
                message.error('请求失败');
            }
        }
    });
};

// 格式化时间
const formatTime = (timestamp) => {
    if (!timestamp) return '-';
    const date = new Date(timestamp);
    return date.toLocaleString('zh-CN', {
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
    });
};

// 格式化耗时
const formatDuration = (ms) => {
    if (!ms) return '-';
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(1)}s`;
};

// 截断文本
const truncateText = (text, maxLen = 120) => {
    if (!text) return '-';
    return text.length > maxLen ? text.substring(0, maxLen) + '...' : text;
};

// 判断响应是否有媒体内容
const hasMedia = (record) => {
    return record.responseMedia && record.responseMedia.length > 0;
};

// 获取第一个媒体
const getFirstMedia = (record) => {
    if (!hasMedia(record)) return null;
    return record.responseMedia[0];
};

// 表格列定义
const columns = [
    {
        title: '时间',
        dataIndex: 'created_at',
        key: 'created_at',
        width: 100,
        customRender: ({ value }) => formatTime(value)
    },
    {
        title: '模型',
        dataIndex: 'model_name',
        key: 'model_name',
        width: 150,
        ellipsis: true
    },
    {
        title: 'Prompt',
        dataIndex: 'prompt',
        key: 'prompt',
        width: 200
    },
    {
        title: '响应',
        key: 'response',
        width: 220
    },
    {
        title: '媒体',
        key: 'media',
        width: 180,
        align: 'center'
    },
    {
        title: '状态',
        dataIndex: 'status',
        key: 'status',
        width: 70,
        align: 'center'
    },
    {
        title: '耗时',
        dataIndex: 'duration_ms',
        key: 'duration_ms',
        width: 60,
        align: 'right',
        customRender: ({ value }) => formatDuration(value)
    },
    {
        title: '',
        key: 'action',
        width: 70,
        align: 'center',
        fixed: 'right'
    }
];

// 监听筛选变化
watch([statusFilter, modelFilter, dateRange], () => {
    page.value = 1;
    fetchHistory();
    fetchStats();
});

// 搜索防抖
let searchTimeout = null;
watch(searchText, () => {
    if (searchTimeout) clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => {
        page.value = 1;
        fetchHistory();
    }, 300);
});

// 分页变化
const handleTableChange = (pagination) => {
    page.value = pagination.current;
    pageSize.value = pagination.pageSize;
    fetchHistory();
};

// 刷新
const handleRefresh = () => {
    fetchHistory();
    fetchModels();
};

onMounted(() => {
    fetchHistory();
    fetchStats();
    fetchModels();
});
</script>

<template>
    <!-- 统计摘要 -->
    <a-card title="请求历史" :bordered="false">
        <template #extra>
            <a-button type="link" danger size="small" @click="deleteByDateRange"
                :disabled="!dateRange || dateRange.length !== 2">
                <template #icon>
                    <DeleteOutlined />
                </template>
                删除所选范围
            </a-button>
        </template>

        <div class="stats-content">
            <a-range-picker v-model:value="dateRange" :format="'YYYY-MM-DD'" :placeholder="['开始日期', '结束日期']"
                size="small" style="width: 240px" />

            <a-divider type="vertical" style="height: 32px; margin: 0 16px" />

            <div class="stats-numbers">
                <div class="stat-item neutral">
                    <FileTextOutlined />
                    <span class="stat-value">{{ stats.total }}</span>
                    <span class="stat-label">总数</span>
                </div>
                <div class="stat-item success">
                    <CheckCircleOutlined />
                    <span class="stat-value">{{ stats.success }}</span>
                    <span class="stat-label">成功</span>
                </div>
                <div class="stat-item error">
                    <CloseCircleOutlined />
                    <span class="stat-value">{{ stats.failed }}</span>
                    <span class="stat-label">失败</span>
                </div>
                <div class="stat-item neutral">
                    <ClockCircleOutlined />
                    <span class="stat-value">{{ formatDuration(stats.avgDuration) }}</span>
                    <span class="stat-label">平均耗时</span>
                </div>
            </div>
        </div>
    </a-card>

    <!-- 历史记录表格 -->
    <a-card :bordered="false" style="margin-top: 24px">
        <!-- 筛选工具栏 -->
        <div class="toolbar">
            <div class="toolbar-row">
                <a-select v-model:value="statusFilter" style="width: 100px" size="small" placeholder="状态">
                    <a-select-option value="all">全部状态</a-select-option>
                    <a-select-option value="success">成功</a-select-option>
                    <a-select-option value="failed">失败</a-select-option>
                    <a-select-option value="pending">处理中</a-select-option>
                </a-select>
                <a-select v-model:value="modelFilter" style="width: 200px" size="small" placeholder="全部模型"
                    allow-clear show-search>
                    <a-select-option v-for="model in modelOptions" :key="model" :value="model">
                        {{ model }}
                    </a-select-option>
                </a-select>
                <a-button size="small" @click="handleRefresh">
                    <template #icon>
                        <ReloadOutlined />
                    </template>
                </a-button>
            </div>
            <div class="toolbar-row">
                <a-input-search v-model:value="searchText" placeholder="搜索 Prompt 或响应内容" size="small"
                    allow-clear style="width: 100%;" />
            </div>
        </div>

        <!-- 表格 -->
        <a-table
            :columns="columns"
            :data-source="records"
            :loading="loading"
            :pagination="{
                current: page,
                pageSize: pageSize,
                total: total,
                showSizeChanger: true,
                showQuickJumper: true,
                showTotal: (total) => `共 ${total} 条`
            }"
            row-key="id"
            size="small"
            :scroll="{ x: 1000 }"
            @change="handleTableChange"
        >
            <template #bodyCell="{ column, record }">
                <!-- Prompt 列：支持多行 -->
                <template v-if="column.key === 'prompt'">
                    <div class="multiline-text">
                        {{ truncateText(record.prompt, 120) }}
                    </div>
                </template>

                <!-- 响应列 -->
                <template v-else-if="column.key === 'response'">
                    <div v-if="record.status === 'failed'" class="multiline-text error-text">
                        {{ truncateText(record.error_message, 120) || '错误' }}
                    </div>
                    <div v-else class="multiline-text response-text">
                        {{ truncateText(record.response_text, 120) || '-' }}
                    </div>
                </template>

                <!-- 媒体列：显示缩略图 -->
                <template v-else-if="column.key === 'media'">
                    <div v-if="hasMedia(record)" class="media-thumb-cell" @click="viewDetail(record)">
                        <template v-if="getFirstMedia(record).status === 'downloaded'">
                            <img
                                v-if="getFirstMedia(record).type === 'image'"
                                :src="getCachedMediaUrl(getFirstMedia(record))"
                                class="thumb-img"
                                loading="lazy"
                            />
                            <div v-else-if="getFirstMedia(record).type === 'video'" class="thumb-video">
                                <PlayCircleOutlined />
                            </div>
                        </template>
                        <div v-else class="thumb-placeholder">
                            <PictureOutlined v-if="getFirstMedia(record).type === 'image'" />
                            <PlayCircleOutlined v-else />
                        </div>
                        <span v-if="record.responseMedia.length > 1" class="media-count">
                            +{{ record.responseMedia.length - 1 }}
                        </span>
                    </div>
                    <span v-else class="no-media">-</span>
                </template>

                <!-- 状态列 -->
                <template v-else-if="column.key === 'status'">
                    <a-tag :color="statusConfig[record.status]?.color || '#8c8c8c'" size="small">
                        {{ statusConfig[record.status]?.text || record.status }}
                    </a-tag>
                </template>

                <!-- 操作列 -->
                <template v-else-if="column.key === 'action'">
                    <a-space :size="0">
                        <a-tooltip title="详情">
                            <a-button type="link" size="small" @click="viewDetail(record)">
                                <template #icon>
                                    <EyeOutlined />
                                </template>
                            </a-button>
                        </a-tooltip>
                        <a-tooltip title="删除">
                            <a-button type="link" size="small" danger @click="deleteRecords([record.id])">
                                <template #icon>
                                    <DeleteOutlined />
                                </template>
                            </a-button>
                        </a-tooltip>
                    </a-space>
                </template>
            </template>
        </a-table>
    </a-card>

    <!-- 详情抽屉 -->
    <a-drawer v-model:open="drawerVisible" title="请求详情" placement="right" :width="700" :destroy-on-close="true">
        <a-spin :spinning="detailLoading">
            <template v-if="currentRecord">
                <!-- 基本信息 -->
                <a-descriptions :column="2" size="small" bordered>
                    <a-descriptions-item label="请求 ID" :span="2">
                        <code>{{ currentRecord.id }}</code>
                    </a-descriptions-item>
                    <a-descriptions-item label="时间">
                        {{ new Date(currentRecord.created_at).toLocaleString('zh-CN') }}
                    </a-descriptions-item>
                    <a-descriptions-item label="状态">
                        <a-tag :color="statusConfig[currentRecord.status]?.color">
                            {{ statusConfig[currentRecord.status]?.text || currentRecord.status }}
                        </a-tag>
                    </a-descriptions-item>
                    <a-descriptions-item label="模型" :span="2">
                        {{ currentRecord.model_name || currentRecord.model_id || '-' }}
                    </a-descriptions-item>
                    <a-descriptions-item label="耗时">
                        {{ formatDuration(currentRecord.duration_ms) }}
                    </a-descriptions-item>
                    <a-descriptions-item label="流式">
                        {{ currentRecord.isStreaming ? '是' : '否' }}
                    </a-descriptions-item>
                </a-descriptions>

                <!-- Prompt -->
                <a-divider orientation="left">Prompt</a-divider>
                <div class="content-box">
                    {{ currentRecord.prompt || '无' }}
                </div>

                <!-- 输入图片 -->
                <template v-if="currentRecord.inputImages && currentRecord.inputImages.length > 0">
                    <a-divider orientation="left">输入图片</a-divider>
                    <div class="media-list">
                        <span v-for="(img, idx) in currentRecord.inputImages" :key="idx" class="media-item">
                            <a-tag>{{ img.split('/').pop() }}</a-tag>
                        </span>
                    </div>
                </template>

                <!-- 响应内容 -->
                <a-divider orientation="left">响应内容</a-divider>
                <div class="content-box" :class="{ 'error-box': currentRecord.status === 'failed' }">
                    <template v-if="currentRecord.status === 'failed'">
                        {{ currentRecord.error_message || '未知错误' }}
                    </template>
                    <template v-else>
                        {{ currentRecord.response_text || '无响应' }}
                    </template>
                </div>

                <!-- 思考过程 -->
                <template v-if="currentRecord.reasoning_content">
                    <a-divider orientation="left">思考过程</a-divider>
                    <div class="content-box reasoning-box">
                        {{ currentRecord.reasoning_content }}
                    </div>
                </template>

                <!-- 媒体内容 -->
                <template v-if="currentRecord.responseMedia && currentRecord.responseMedia.length > 0">
                    <a-divider orientation="left">媒体内容 ({{ currentRecord.responseMedia.length }})</a-divider>
                    <div class="media-gallery-large">
                        <div v-for="(media, idx) in currentRecord.responseMedia" :key="idx" class="media-card-large">
                            <div class="media-preview-large">
                                <template v-if="media.status === 'downloaded' && getCachedMediaUrl(media)">
                                    <img v-if="media.type === 'image'" :src="getCachedMediaUrl(media)" alt="生成图片" />
                                    <video v-else-if="media.type === 'video'" :src="getCachedMediaUrl(media)" controls />
                                </template>
                                <template v-else>
                                    <div class="media-placeholder-large">
                                        <PictureOutlined v-if="media.type === 'image'" />
                                        <PlayCircleOutlined v-else-if="media.type === 'video'" />
                                        <FileTextOutlined v-else />
                                        <div class="media-status">
                                            <a-tag v-if="media.status === 'failed'" color="red">下载失败</a-tag>
                                            <a-tag v-else-if="media.status === 'external'" color="blue">外部链接</a-tag>
                                            <a-tag v-else-if="media.status === 'pending'" color="orange">待下载</a-tag>
                                        </div>
                                        <a-button v-if="media.status === 'failed'" type="primary" size="small"
                                            @click="retryMedia(currentRecord.id, idx)">
                                            <template #icon>
                                                <ReloadOutlined />
                                            </template>
                                            重试下载
                                        </a-button>
                                    </div>
                                </template>
                            </div>
                        </div>
                    </div>
                </template>
            </template>
        </a-spin>
    </a-drawer>
</template>

<style scoped>
/* 统计内容样式 */
.stats-content {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 8px;
}

.stats-numbers {
    display: flex;
    align-items: center;
    gap: 20px;
}

.stat-item {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 4px 12px;
    background: #fafafa;
    border-radius: 6px;
    transition: all 0.2s;
}

.stat-item:hover {
    background: #f0f0f0;
}

.stat-item.success {
    color: #52c41a;
}

.stat-item.error {
    color: #ff4d4f;
}

.stat-item.neutral {
    color: #8c8c8c;
}

.stat-value {
    font-size: 18px;
    font-weight: 600;
    font-family: 'SF Mono', 'Monaco', monospace;
}

.stat-label {
    font-size: 12px;
    color: #8c8c8c;
}

/* 工具栏样式 */
.toolbar {
    margin-bottom: 16px;
}

.toolbar-row {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 8px;
}

.toolbar-row:last-child {
    margin-bottom: 0;
}

@media (min-width: 768px) {
    .toolbar {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 12px;
    }

    .toolbar-row {
        margin-bottom: 0;
    }

    .toolbar-row:last-child {
        flex: 1;
        max-width: 300px;
    }
}

/* 表格内样式 */
.error-text {
    color: #ff4d4f;
    font-size: 12px;
}

.response-text {
    font-size: 12px;
    color: #595959;
}

/* 多行文本 */
.multiline-text {
    font-size: 12px;
    line-height: 1.5;
    max-height: 54px;  /* 约 3 行 */
    overflow: hidden;
    word-break: break-all;
}

.no-media {
    color: #bfbfbf;
}

/* 表格行高度适配大缩略图 */
:deep(.ant-table-tbody > tr > td) {
    vertical-align: middle;
}

/* 列表缩略图 - 160x160 */
.media-thumb-cell {
    position: relative;
    width: 160px;
    height: 160px;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    margin: 8px auto;
}

.thumb-img {
    width: 160px;
    height: 160px;
    object-fit: cover;
    border-radius: 4px;
    border: 1px solid #f0f0f0;
}

.thumb-video {
    width: 160px;
    height: 160px;
    background: #000;
    border-radius: 4px;
    display: flex;
    align-items: center;
    justify-content: center;
    color: #fff;
    font-size: 28px;
}

.thumb-placeholder {
    width: 160px;
    height: 160px;
    background: #fafafa;
    border: 1px dashed #d9d9d9;
    border-radius: 4px;
    display: flex;
    align-items: center;
    justify-content: center;
    color: #bfbfbf;
    font-size: 24px;
}

.media-count {
    position: absolute;
    bottom: 4px;
    right: 4px;
    background: rgba(0, 0, 0, 0.6);
    color: #fff;
    font-size: 11px;
    padding: 2px 6px;
    border-radius: 3px;
}

/* 内容框样式 */
.content-box {
    background: #fafafa;
    border: 1px solid #f0f0f0;
    border-radius: 4px;
    padding: 12px;
    font-family: 'Consolas', 'Monaco', monospace;
    font-size: 13px;
    white-space: pre-wrap;
    word-break: break-all;
    max-height: 600px;
    overflow-y: auto;
}

.content-box.error-box {
    color: #ff4d4f;
    background: #fff2f0;
    border-color: #ffccc7;
}

.content-box.reasoning-box {
    background: #f6ffed;
    border-color: #b7eb8f;
    color: #389e0d;
}

/* 详情页媒体样式 - 更大尺寸 */
.media-gallery-large {
    display: flex;
    flex-direction: column;
    gap: 16px;
}

.media-card-large {
    border: 1px solid #f0f0f0;
    border-radius: 8px;
    overflow: hidden;
    background: #fafafa;
}

.media-preview-large {
    width: 100%;
    min-height: 300px;
    max-height: 500px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: #f5f5f5;
}

.media-preview-large img {
    max-width: 100%;
    max-height: 500px;
    object-fit: contain;
}

.media-preview-large video {
    max-width: 100%;
    max-height: 500px;
}

.media-placeholder-large {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    color: #bfbfbf;
    gap: 12px;
    padding: 40px;
    font-size: 48px;
}

.media-status {
    font-size: 14px;
}

/* 媒体列表 */
.media-list {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
}

/* 响应式 */
@media (max-width: 576px) {
    .stats-content {
        flex-direction: column;
        align-items: flex-start;
    }

    .stats-content .ant-divider {
        display: none;
    }

    .stats-numbers {
        margin-top: 8px;
        flex-wrap: wrap;
    }
}
</style>
