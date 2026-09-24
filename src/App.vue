<script setup lang="ts">
// ============================================================
// 页面层：地图点选、表单、列表与统计的展示和交互
// 业务判定见 biz/stationRules.ts，数据读写见 biz/stationStore.ts
// ============================================================
import { computed, reactive, ref } from "vue";
import { storeToRefs } from "pinia";
import {
  ALL_REGIONS,
  CRITICAL_STOCK_LITERS,
  GRID_SIZE_KM,
  REGIONS,
  codeOf,
  compareByRegionStock,
  formatCoord,
  isCritical,
  stationStatus,
  validateDraft,
  type Coord,
  type Draft,
  type Station,
  type StationStatus,
} from "./biz/stationRules";
import { useStationStore } from "./biz/stationStore";

const store = useStationStore();
const { visibleStations, codes, stats, regionFilter, selectedId } = storeToRefs(store);

const regionTabs = [ALL_REGIONS, ...REGIONS];

// —— 表单（新增 / 编辑共用，先点选坐标再保存） ——
const mode = ref<"create" | "edit">("create");
const editingId = ref<string | null>(null);
const blankDraft = (): Draft => ({ name: "", region: "", stock: 0, manager: "", coord: null });
const form = reactive<Draft>(blankDraft());
const errors = ref<string[]>([]);

function startEdit(station: Station) {
  mode.value = "edit";
  editingId.value = station.id;
  form.name = station.name;
  form.region = station.region;
  form.stock = station.stock;
  form.manager = station.manager;
  form.coord = station.coord ? { ...station.coord } : null;
  errors.value = [];
  store.select(station.id);
}

function resetForm() {
  mode.value = "create";
  editingId.value = null;
  Object.assign(form, blankDraft());
  errors.value = [];
}

function submit() {
  errors.value = validateDraft(form);
  if (errors.value.length > 0) return;
  if (mode.value === "edit" && editingId.value) {
    store.updateStation(editingId.value, form);
  } else {
    store.addStation(form);
  }
  resetForm();
}

// —— 地图点选坐标（本地网格，SVG 的 y 轴向下，换算为向北增大） ——
const mapSvg = ref<SVGSVGElement | null>(null);
const gridLines = Array.from({ length: 11 }, (_, i) => i * 10);
const axisTicks = [0, 20, 40, 60, 80, 100];

function pickCoord(event: MouseEvent) {
  const svg = mapSvg.value;
  if (!svg) return;
  const rect = svg.getBoundingClientRect();
  const scale = Math.min(rect.width, rect.height) / GRID_SIZE_KM;
  const offsetX = (rect.width - GRID_SIZE_KM * scale) / 2;
  const offsetY = (rect.height - GRID_SIZE_KM * scale) / 2;
  const x = (event.clientX - rect.left - offsetX) / scale;
  const svgY = (event.clientY - rect.top - offsetY) / scale;
  if (x < 0 || x > GRID_SIZE_KM || svgY < 0 || svgY > GRID_SIZE_KM) return;
  const coord: Coord = {
    x: Math.round(x * 10) / 10,
    y: Math.round((GRID_SIZE_KM - svgY) * 10) / 10,
  };
  form.coord = coord;
  errors.value = errors.value.filter((e) => !e.includes("坐标"));
}

// —— 展示派生 ——
const sortedVisible = computed(() => [...visibleStations.value].sort(compareByRegionStock));
const mappedStations = computed(() =>
  sortedVisible.value.flatMap((s) => (s.coord ? [{ station: s, coord: s.coord }] : [])),
);
const closedInView = computed(() => visibleStations.value.filter((s) => s.closed).length);
const missingCoordInView = computed(() => visibleStations.value.filter((s) => !s.coord).length);

const statusClassMap: Record<StationStatus, string> = {
  营业中: "ok",
  告急: "warn",
  已停业: "off",
  待补坐标: "pending",
};

function codeFor(station: Station) {
  return codeOf(station, codes.value);
}

function countOf(region: string) {
  return region === ALL_REGIONS
    ? store.stations.length
    : store.stations.filter((s) => s.region === region).length;
}

function locate(station: Station) {
  store.select(station.id);
}

function toggleClosed(station: Station) {
  store.setClosed(station.id, !station.closed);
}

function onMarkerClick(station: Station) {
  store.select(station.id === selectedId.value ? null : station.id);
}
</script>

<template>
  <main class="app">
    <div class="shell">
      <header class="topbar">
        <div>
          <p class="eyebrow">石油行业 · 调度配送前端</p>
          <h1>油站网点地图管理</h1>
          <p class="subtitle">
            新增油站先在地图上点选坐标，再登记名称、区域、库存与负责人；同一区域的点位按库存从低到高编号，
            库存不足 {{ CRITICAL_STOCK_LITERS.toLocaleString() }} 升自动标记告急。数据保存在本机浏览器，不接后台与外部地图服务。
          </p>
        </div>
        <div class="stack">
          <span class="tag">Vue3</span>
          <span class="tag">Vite</span>
          <span class="tag">TypeScript</span>
          <span class="tag">Pinia</span>
          <span class="tag">本地网格地图</span>
        </div>
      </header>

      <section class="metrics">
        <article class="metric">
          <span>在营油站（{{ regionFilter }}）</span>
          <strong>{{ stats.active }}</strong>
        </article>
        <article class="metric">
          <span>告急油站（库存 &lt; {{ CRITICAL_STOCK_LITERS.toLocaleString() }}L）</span>
          <strong class="warn-text">{{ stats.critical }}</strong>
        </article>
        <article class="metric">
          <span>调度总库存（升）</span>
          <strong>{{ stats.totalStock.toLocaleString() }}</strong>
        </article>
      </section>
      <p v-if="closedInView > 0 || missingCoordInView > 0" class="metrics-note">
        <template v-if="closedInView > 0">已停业 {{ closedInView }} 座：点位保留在地图上，已退出调度统计。</template>
        <template v-if="missingCoordInView > 0">缺坐标留档 {{ missingCoordInView }} 座：编辑保存前需补选位置。</template>
      </p>

      <section class="workspace">
        <section class="panel map-panel">
          <div class="toolbar">
            <h2>网点地图</h2>
            <span class="map-scope">{{ regionFilter }} · 网格 {{ GRID_SIZE_KM }}km × {{ GRID_SIZE_KM }}km</span>
          </div>
          <svg ref="mapSvg" class="map" viewBox="0 0 100 100" role="img" aria-label="油站分布地图" @click="pickCoord">
            <rect class="map-bg" x="0" y="0" width="100" height="100" />
            <g class="grid">
              <line v-for="g in gridLines" :key="'v' + g" :x1="g" y1="0" :x2="g" y2="100" />
              <line v-for="g in gridLines" :key="'h' + g" x1="0" :y1="g" x2="100" :y2="g" />
            </g>
            <g class="axis">
              <text
                v-for="t in axisTicks"
                :key="'x' + t"
                :x="t"
                y="98.6"
                :text-anchor="t === 0 ? 'start' : t === 100 ? 'end' : 'middle'"
              >{{ t }}</text>
              <text v-for="t in axisTicks.slice(1)" :key="'y' + t" x="1" :y="100 - t + 1">{{ t }}</text>
            </g>

            <g
              v-for="m in mappedStations"
              :key="m.station.id"
              class="marker"
              :class="[statusClassMap[stationStatus(m.station)], { selected: m.station.id === selectedId }]"
              :transform="`translate(${m.coord.x} ${100 - m.coord.y})`"
              @click.stop="onMarkerClick(m.station)"
            >
              <circle class="halo" r="4" />
              <circle class="dot-shape" r="2.1" />
              <text x="3.1" y="1.2">{{ codeFor(m.station) }}</text>
              <title>{{ m.station.name }} · {{ m.station.manager }} · 库存 {{ m.station.stock.toLocaleString() }}L</title>
            </g>

            <g v-if="form.coord" class="pending" :transform="`translate(${form.coord.x} ${100 - form.coord.y})`">
              <line x1="-4.5" y1="0" x2="4.5" y2="0" />
              <line x1="0" y1="-4.5" x2="0" y2="4.5" />
              <circle r="2.4" />
            </g>
          </svg>
          <div class="legend">
            <span><i class="dot ok" />营业中</span>
            <span><i class="dot warn" />告急</span>
            <span><i class="dot off" />已停业</span>
            <span><i class="dot pick" />待保存的坐标</span>
          </div>
          <p class="map-hint">点击地图为表单选取坐标；点击站点圆点可选中。缺坐标的留档记录不落图。</p>
        </section>

        <form class="panel" @submit.prevent="submit">
          <h2>{{ mode === "edit" ? "编辑油站" : "新增油站" }}</h2>
          <p v-if="mode === 'edit' && !form.coord" class="hint">该记录缺坐标，保存前请先在地图上补选位置。</p>
          <div class="coord-box" :class="{ missing: !form.coord }">
            <template v-if="form.coord">已选坐标：{{ formatCoord(form.coord) }}（点击地图可改选）</template>
            <template v-else>尚未选取坐标 —— 请先在左侧地图上点选</template>
          </div>
          <div class="form-grid">
            <label>
              油站名称
              <input v-model="form.name" placeholder="如：东区三站" />
            </label>
            <label>
              区域
              <select v-model="form.region">
                <option value="" disabled>请选择区域</option>
                <option v-for="r in REGIONS" :key="r" :value="r">{{ r }}</option>
              </select>
            </label>
            <label>
              当前库存（升）
              <input v-model.number="form.stock" type="number" min="0" step="100" />
            </label>
            <label>
              负责人
              <input v-model="form.manager" placeholder="如：刘站长" />
            </label>
          </div>
          <ul v-if="errors.length" class="errors">
            <li v-for="e in errors" :key="e">{{ e }}</li>
          </ul>
          <button type="submit">{{ mode === "edit" ? "保存修改" : "保存油站" }}</button>
          <button v-if="mode === 'edit'" type="button" class="secondary" @click="resetForm">取消编辑</button>
        </form>
      </section>

      <section class="list-panel">
        <div class="toolbar">
          <h2>油站列表</h2>
          <div class="tabs">
            <button
              v-for="t in regionTabs"
              :key="t"
              type="button"
              class="tab"
              :class="{ active: regionFilter === t }"
              @click="store.setRegionFilter(t)"
            >
              {{ t }}<span class="count">{{ countOf(t) }}</span>
            </button>
          </div>
        </div>

        <div class="record-grid">
          <div v-if="sortedVisible.length === 0" class="empty">该区域暂无油站</div>
          <article
            v-for="s in sortedVisible"
            :key="s.id"
            class="record"
            :class="{ selected: s.id === selectedId, closed: s.closed }"
          >
            <div class="record-head">
              <p class="record-title"><span class="code">{{ codeFor(s) }}</span>{{ s.name }}</p>
              <span class="status" :class="statusClassMap[stationStatus(s)]">{{ stationStatus(s) }}</span>
            </div>
            <div class="details">
              <span>区域：{{ s.region }}</span>
              <span>库存：{{ s.stock.toLocaleString() }} 升</span>
              <span>负责人：{{ s.manager }}</span>
              <span>坐标：{{ formatCoord(s.coord) }}</span>
            </div>
            <p v-if="!s.coord" class="note">旧记录缺坐标，已留档；点击“编辑”并在地图上补选位置后才能保存。</p>
            <p v-else-if="s.closed" class="note">已停业：点位保留在地图上供查看，不再计入调度统计。</p>
            <p v-else-if="isCritical(s.stock)" class="note warn-note">
              库存不足 {{ CRITICAL_STOCK_LITERS.toLocaleString() }} 升，告急，请优先安排配送。
            </p>
            <div class="actions">
              <button type="button" @click="startEdit(s)">编辑</button>
              <button type="button" class="secondary" :disabled="!s.coord" @click="locate(s)">地图定位</button>
              <button type="button" :class="s.closed ? 'secondary' : 'danger'" @click="toggleClosed(s)">
                {{ s.closed ? "恢复营业" : "停业" }}
              </button>
            </div>
          </article>
        </div>
      </section>
    </div>
  </main>
</template>
