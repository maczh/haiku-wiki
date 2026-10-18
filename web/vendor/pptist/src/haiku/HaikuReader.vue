<script setup lang="ts">
import { onMounted, onUnmounted, shallowRef, useTemplateRef } from 'vue'
import { useSlidesStore, useScreenStore } from '@/store'
import ThumbnailSlide from '@/views/components/ThumbnailSlide/index.vue'

const slides = useSlidesStore()
const screen = useScreenStore()
const host = useTemplateRef<HTMLElement>('host')
const width = shallowRef(720)
const observer = new ResizeObserver(([entry]) => { width.value = Math.max(100, Math.min(1200, entry.contentRect.width - 32)) })
onMounted(() => { if (host.value) observer.observe(host.value) })
onUnmounted(() => observer.disconnect())
function play(index: number) { slides.updateSlideIndex(index); screen.setScreening(true) }
</script>

<template>
  <div ref="host" class="haiku-reader">
    <div v-for="(slide, index) in slides.slides" :key="slide.id" class="haiku-page">
      <button @click="play(index)">第 {{ index + 1 }} / {{ slides.slides.length }} 页 · 从此页放映</button>
      <ThumbnailSlide :slide="slide" :size="width" />
    </div>
  </div>
</template>

<style scoped>
.haiku-reader { height: 100%; overflow: auto; background: #eff1f5; }
.haiku-page { width: fit-content; margin: 16px auto 24px; }
button { margin-bottom: 8px; padding: 6px 12px; cursor: pointer; border: 1px solid #d9dde5; background: white; border-radius: 5px; }
</style>
