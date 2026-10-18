<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { useScreenStore } from '@/store'
import { isPC } from '@/utils/common'
import { useHaikuBridge } from './useHaikuBridge'
import Editor from '@/views/Editor/index.vue'
import Mobile from '@/views/Mobile/index.vue'
import Screen from '@/views/Screen/index.vue'
import HaikuReader from './HaikuReader.vue'

const { ready, readOnly, error } = useHaikuBridge()
const { screening } = storeToRefs(useScreenStore())
const desktop = isPC()
</script>

<template>
  <div v-if="error" class="haiku-status" role="alert">{{ error }}</div>
  <div v-else-if="!ready" class="haiku-status">正在加载演示文稿…</div>
  <Screen v-else-if="screening" />
  <HaikuReader v-else-if="readOnly" />
  <Editor v-else-if="desktop" />
  <Mobile v-else />
</template>

<style>
#app { height: 100%; }
.haiku-status { padding: 24px; text-align: center; }
/* 在线素材和 AI 功能依赖上游演示服务，当前集成仅启用本地文档能力。 */
.editor-header .ai-menu, .editor-header .menu-item:has(.ai), .mobile-preview .menu-item.ai { display: none; }
</style>
