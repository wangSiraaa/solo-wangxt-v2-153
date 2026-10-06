<script lang="ts">
  import TrackEditor from './components/TrackEditor.svelte';
  import ThreeView from './components/ThreeView.svelte';
  import ParamsPanel from './components/ParamsPanel.svelte';
  import ResultsPanel from './components/ResultsPanel.svelte';
</script>

<div class="app">
  <header>
    <h1>赛车线 / 速度上限离线工具</h1>
    <span class="sub">二维质点模型 · 曲率限速 + 前后向传播 · 仅供游戏调参</span>
  </header>
  <aside><ParamsPanel /></aside>
  <main class="editor"><TrackEditor /></main>
  <main class="three"><ThreeView /></main>
  <footer><ResultsPanel /></footer>
</div>

<style>
  .app {
    display: grid;
    grid-template-columns: 300px 1fr 1fr;
    grid-template-rows: 44px 1fr 1fr 320px;
    grid-template-areas:
      'header header header'
      'side editor three'
      'side editor three'
      'side results results';
    height: 100vh;
    background: #191d24;
    color: #dde3ec;
    font-family: 'Segoe UI', system-ui, sans-serif;
  }
  header {
    grid-area: header;
    display: flex;
    align-items: baseline;
    gap: 14px;
    padding: 0 14px;
    background: #21262f;
    border-bottom: 1px solid #2c333f;
  }
  header h1 { font-size: 15px; margin: 0; line-height: 44px; }
  header .sub { font-size: 12px; color: #7a828f; }
  aside { grid-area: side; background: #1d222b; border-right: 1px solid #2c333f; min-height: 0; }
  .editor { grid-area: editor; min-height: 0; border-right: 1px solid #2c333f; }
  .three { grid-area: three; min-height: 0; }
  footer { grid-area: results; border-top: 1px solid #2c333f; min-height: 0; }
</style>
