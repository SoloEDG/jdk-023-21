<script setup lang="ts">
import { computed } from 'vue'
import type { PinballDocument } from '@/shared/document'
import { goalViews } from '@/features/records/model/challenge-rules'
import { dailyGoalViews } from '@/features/records/model/daily-rules'

const props = defineProps<{ doc: PinballDocument }>()
const goals = computed(() => goalViews(props.doc))
const daily = computed(() => dailyGoalViews(props.doc))
</script>

<template>
  <section class="slip" aria-label="挑战">
    <header class="slip-head">
      <p class="eyebrow">挑战</p>
      <h2>本局与生涯 · 当日目标</h2>
    </header>
    <div class="goal-columns">
      <div>
        <ul class="goal-list">
          <li v-for="goal in goals" :key="goal.id">
            <div>
              <strong>{{ goal.label }}</strong>
              <p>{{ goal.detail }}</p>
            </div>
            <div class="badges">
              <span :class="{ lit: goal.liveDone }">本局</span>
              <span :class="{ lit: goal.careerDone }">生涯</span>
            </div>
          </li>
        </ul>
      </div>
      <div class="daily-block">
        <p class="eyebrow">当日 · {{ doc.daily.day || '——' }}</p>
        <ul class="goal-list">
          <li v-for="goal in daily" :key="goal.id">
            <div>
              <strong>{{ goal.label }}</strong>
              <p>{{ goal.detail }}</p>
            </div>
            <div class="badges">
              <span :class="{ lit: goal.done }">当日</span>
            </div>
          </li>
        </ul>
        <p class="daily-note">当日目标在开局时定下，跨过午夜也不算到新的一天。</p>
      </div>
    </div>
  </section>
</template>
