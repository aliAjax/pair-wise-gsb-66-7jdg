<script setup lang="ts">
import { computed } from 'vue'
import { RouterLink, RouterView, useRoute } from 'vue-router'
import { useTrackStore } from './stores/track'

const route = useRoute()
const store = useTrackStore()
const title = computed(() => route.name === 'track' ? '区段里程与缺陷分布' : route.name === 'workOrders' ? '整治任务与复测' : route.name === 'sync' ? '离线补传与冲突确认' : route.name === 'audit' ? '整治审计' : '轨道缺陷总览')
</script>

<template>
  <v-app>
    <aside class="shell-nav">
      <div class="brand"><strong>轨</strong><div><b>轨道几何整治台</b><span>缺陷派工、复测与限速联查</span></div></div>
      <nav>
        <RouterLink to="/"><span>缺陷总览</span><small>{{ store.filtered.length }} 项</small></RouterLink>
        <RouterLink to="/track"><span>里程与区段</span><small>Canvas</small></RouterLink>
        <RouterLink to="/work-orders"><span>整治复测</span><small>{{ store.defects.filter((item) => item.status !== '已关闭').length }} 项</small></RouterLink>
        <RouterLink to="/sync">
          <span>补传中心<em v-if="store.conflictCount" class="badge conflict">{{ store.conflictCount }} 冲突</em><em v-else-if="store.pendingCount" class="badge pending">{{ store.pendingCount }} 待补传</em></span>
          <small>{{ store.network === 'offline' ? '隧道断网中' : '在线' }}</small>
        </RouterLink>
        <RouterLink to="/audit"><span>审计追溯</span><small>{{ store.audit.length }} 条</small></RouterLink>
      </nav>
      <div class="aside-data"><span>数据接入</span><strong>{{ store.network === 'offline' ? '隧道断网：本机暂存' : '轨检车数据已导入' }}</strong><small>本地持久化 / 可离线补录</small></div>
    </aside>
    <v-main class="shell-main">
      <header class="top"><div><span>工务调度中心 / 轨道几何</span><h1>{{ title }}</h1></div><div><small>线别 / 网络</small><strong>京广上行 / 沪昆下行 · {{ store.network === 'offline' ? '断网' : '在线' }}</strong></div></header>
      <RouterView />
    </v-main>
  </v-app>
</template>

<style scoped>
.badge { font-style: normal; font-size: 10px; padding: 1px 6px; border-radius: 8px; margin-left: 6px; vertical-align: middle; }
.badge.pending { background: #c69c3f; color: #25394a; }
.badge.conflict { background: #b64b45; color: white; }
</style>
