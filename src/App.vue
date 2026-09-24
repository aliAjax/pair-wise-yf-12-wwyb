<script setup lang="ts">
// 页面层：区域过滤、顶部统计、新增/编辑表单、地图点选、油站列表与旧档列表。
import { computed, ref } from "vue";
import StationMap from "./components/StationMap.vue";
import {
  AREAS,
  buildAreaNumbers,
  hasCoordinate,
  isClosed,
  isUrgent,
  LOW_STOCK_THRESHOLD,
  summarize,
  validateDraft,
  type AreaName,
  type Station,
} from "./business/rules";
import { useStationStore } from "./business/archive";

const store = useStationStore();

const ALL_AREAS = "全部区域" as const;
const filter = ref<typeof ALL_AREAS | AreaName>(ALL_AREAS);
const selectedId = ref<string | null>(null);
const formError = ref("");

/** 编号按全量点位计算，保证同区域序号稳定 */
const numbers = computed(() => buildAreaNumbers(store.stations));

/** 列表切到某区域后，地图和顶部统计只看这批油站；留档点不进地图 */
const scopedStations = computed<Station[]>(() => {
  const list = store.stations.filter(
    (station) => !station.archived &&
      (filter.value === ALL_AREAS || station.area === filter.value),
  );
  return list.sort((a, b) => {
    if (a.area !== b.area) return AREAS.indexOf(a.area) - AREAS.indexOf(b.area);
    return (numbers.value.get(a.id) ?? 0) - (numbers.value.get(b.id) ?? 0);
  });
});

const stats = computed(() => summarize(scopedStations.value));

const archivedList = computed(() =>
  store.stations
    .filter((s) => s.archived && (filter.value === ALL_AREAS || s.area === filter.value))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
);

const picked = computed(() =>
  hasCoordinate(store.draft) ? { lng: store.draft.lng, lat: store.draft.lat } : undefined,
);

const isEditing = computed(() => store.editingId !== null);
const editingStation = computed(() => store.stations.find((s) => s.id === store.editingId) ?? null);

function onPick(point: { lng: number; lat: number }) {
  store.setCoordinate(point.lng, point.lat);
  formError.value = "";
}

function startCreate() {
  store.startCreate();
  formError.value = "";
}

function startEdit(station: Station) {
  store.startEdit(station);
  selectedId.value = station.id;
  formError.value = "";
}

/** 旧记录缺坐标先留档，编辑保存前要补位置 */
function save() {
  const error = validateDraft(store.draft);
  if (error) {
    formError.value = error;
    return;
  }
  formError.value = "";
  if (store.editingId) {
    store.updateStation(store.editingId, store.draft);
    selectedId.value = store.editingId;
  } else {
    const created = store.addStation(store.draft);
    selectedId.value = created.id;
    filter.value = created.area;
  }
  store.cancelEdit();
}

function toggleClosed(station: Station) {
  store.toggleClosed(station.id);
}

function selectStation(station: Station) {
  selectedId.value = station.id;
}
</script>

<template>
  <main class="app">
    <div class="shell">
      <header class="topbar">
        <div>
          <p class="eyebrow">石油行业 · 油站调度</p>
          <h1>油站网点地图管理</h1>
          <p class="subtitle">
            新增油站先在地图点选坐标，再保存名称、区域、库存和负责人；同区域按库存从低到高编号，库存不足
            {{ LOW_STOCK_THRESHOLD.toLocaleString() }} 升自动标为告急。
          </p>
        </div>
        <div class="stack">
          <span class="tag">Vue3</span>
          <span class="tag">TypeScript</span>
          <span class="tag">Leaflet</span>
          <span class="tag">本地存档</span>
        </div>
      </header>

      <div class="toolbar toolbar-top">
        <div class="area-tabs">
          <button
            type="button"
            :class="['tab', { active: filter === ALL_AREAS }]"
            @click="filter = ALL_AREAS"
          >
            全部区域
          </button>
          <button
            v-for="area in AREAS"
            :key="area"
            type="button"
            :class="['tab', { active: filter === area }]"
            @click="filter = area"
          >
            {{ area }}
          </button>
        </div>
      </div>

      <section class="metrics">
        <article class="metric">
          <span>调度油站数（{{ filter }}）</span>
          <strong>{{ stats.dispatchCount }}</strong>
        </article>
        <article class="metric" :class="{ alert: stats.urgentCount > 0 }">
          <span>库存告急（&lt; {{ LOW_STOCK_THRESHOLD.toLocaleString() }} L）</span>
          <strong>{{ stats.urgentCount }}</strong>
        </article>
        <article class="metric">
          <span>调度库存合计（L）</span>
          <strong>{{ stats.totalStock.toLocaleString() }}</strong>
        </article>
      </section>

      <section class="workspace">
        <form class="panel" @submit.prevent="save">
          <h2>{{ isEditing ? "编辑油站（补位置）" : "新增油站" }}</h2>
          <p v-if="isEditing && editingStation?.archived" class="archived-banner">
            该站是缺坐标的旧档记录，保存前请在地图点击补齐位置。
          </p>

          <div class="form-grid">
            <label>
              油站名称
              <input v-model="store.draft.name" type="text" placeholder="如：东区一站" />
            </label>
            <label>
              区域
              <select v-model="store.draft.area">
                <option v-for="area in AREAS" :key="area" :value="area">{{ area }}</option>
              </select>
            </label>
            <label>
              库存（升）
              <input v-model.number="store.draft.stock" type="number" min="0" step="100" />
            </label>
            <label>
              负责人
              <input v-model="store.draft.manager" type="text" placeholder="站长姓名" />
            </label>
            <label>
              坐标（在下方地图点选）
              <div class="coord-box">
                <template v-if="picked">
                  <span>经度 {{ picked.lng }}</span>
                  <span>纬度 {{ picked.lat }}</span>
                </template>
                <span v-else class="coord-empty">尚未点选，请在地图点击位置</span>
              </div>
            </label>
            <label>
              备注
              <textarea v-model="store.draft.notes" placeholder="现场备注或调度说明" />
            </label>
            <p v-if="formError" class="form-error">{{ formError }}</p>
            <div class="form-actions">
              <button type="submit">{{ isEditing ? "保存修改" : "保存油站" }}</button>
              <button v-if="isEditing" type="button" class="secondary" @click="store.cancelEdit()">
                取消
              </button>
            </div>
            <button v-if="!isEditing" type="button" class="ghost" @click="startCreate">
              清空表单
            </button>
          </div>
        </form>

        <div class="map-panel panel">
          <StationMap
            :stations="scopedStations"
            :numbers="numbers"
            :picked="picked"
            :editing-id="store.editingId"
            :selected-id="selectedId"
            @pick="onPick"
            @select="(id) => (selectedId = id)"
          />
        </div>
      </section>

      <section class="list-panel panel">
        <div class="toolbar">
          <h2>油站列表（{{ filter }}）</h2>
          <p class="list-legend">序号按区域内库存从低到高</p>
        </div>

        <div class="record-grid">
          <div v-if="scopedStations.length === 0" class="empty">该区域暂无在册油站</div>
          <article
            v-for="station in scopedStations"
            :key="station.id"
            class="record"
            :class="{
              urgent: isUrgent(station.stock) && !isClosed(station),
              closed: isClosed(station),
              selected: station.id === selectedId,
            }"
            @click="selectStation(station)"
          >
            <div class="record-head">
              <p class="record-title">
                <span class="area-no">{{ station.area }} #{{ numbers.get(station.id) }}</span>
                {{ station.name }}
              </p>
              <span
                v-if="isClosed(station)"
                class="badge badge-closed"
              >停业</span>
              <span v-else-if="isUrgent(station.stock)" class="badge badge-urgent">库存告急</span>
              <span v-else class="badge badge-ok">正常</span>
            </div>
            <div class="details">
              <span>库存：{{ station.stock.toLocaleString() }} L</span>
              <span>负责人：{{ station.manager }}</span>
              <span>
                坐标：{{ hasCoordinate(station) ? `${station.lng}, ${station.lat}` : "—" }}
              </span>
              <span>状态：{{ station.status }}</span>
            </div>
            <p class="note">{{ station.notes || "暂无备注" }}</p>
            <div class="actions" @click.stop>
              <button type="button" class="secondary" @click="startEdit(station)">编辑/改位置</button>
              <button
                type="button"
                :class="isClosed(station) ? '' : 'danger'"
                @click="toggleClosed(station)"
              >
                {{ isClosed(station) ? "恢复营业" : "停业" }}
              </button>
            </div>
            <p v-if="isClosed(station)" class="closed-note">
              停业站点位仍可在地图查看，已从调度统计退出。
            </p>
          </article>
        </div>

        <div v-if="archivedList.length > 0" class="archive">
          <h3>旧档留档（缺坐标，不参与编号与调度）</h3>
          <div v-for="station in archivedList" :key="station.id" class="archive-item">
            <div>
              <strong>{{ station.name }}</strong>
              <span class="archive-meta">
                {{ station.area }}｜库存 {{ station.stock.toLocaleString() }} L｜{{ station.manager }}
              </span>
            </div>
            <button type="button" class="secondary" @click="startEdit(station)">
              补位置并编辑
            </button>
          </div>
        </div>
      </section>
    </div>
  </main>
</template>
