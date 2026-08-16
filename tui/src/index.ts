/* eslint-disable @typescript-eslint/no-require-imports */
const blessed = require('blessed') as typeof import('blessed');
const contrib = require('blessed-contrib') as {
  grid: new (opts: {
    rows: number;
    cols: number;
    screen: ReturnType<typeof blessed.screen>;
  }) => {
    set: (
      row: number,
      col: number,
      rowSpan: number,
      colSpan: number,
      widget: unknown,
      opts: Record<string, unknown>
    ) => ReturnType<typeof blessed.box>;
  };
  line: unknown;
  table: unknown;
  sparkline: unknown;
  gauge: unknown;
  log: unknown;
  bar: unknown;
  map: unknown;
  lcd: unknown;
  donut: unknown;
  markdown: unknown;
  picture: unknown;
  listcontrib: unknown;
};

import { listProjects, getMetrics, getMonthCost, type ProjectRecord } from './store';
import { checkCredentials, saveCredentials, type AwsIdentity } from './auth';

// ─── Screen (shared across auth + dashboard) ──────────────────────────────────

const screen = blessed.screen({
  smartCSR: true,
  title: 'AWS Cost Optimizer HUD',
  fullUnicode: true,
});

screen.key(['q', 'C-c'], () => process.exit(0));

// ─── Auth Form ────────────────────────────────────────────────────────────────

function showAuthForm(): Promise<void> {
  return new Promise((resolve, reject) => {
    const overlay = blessed.box({
      parent: screen,
      top: 'center',
      left: 'center',
      width: 60,
      height: 18,
      border: { type: 'line', fg: 'yellow' as unknown as number },
      style: { bg: 'black', border: { fg: 'yellow' as unknown as number } },
      label: ' {yellow-fg}AWS 인증 설정{/yellow-fg} ',
      tags: true,
    });

    blessed.text({
      parent: overlay,
      top: 1,
      left: 2,
      content: '{gray-fg}저장된 credentials가 없거나 유효하지 않습니다.{/gray-fg}',
      tags: true,
      style: { bg: 'black' },
    });

    // Access Key ID
    blessed.text({
      parent: overlay,
      top: 3,
      left: 2,
      content: 'Access Key ID:',
      style: { fg: 'white', bg: 'black' },
    });
    const keyInput = blessed.textbox({
      parent: overlay,
      top: 3,
      left: 18,
      width: 36,
      height: 1,
      inputOnFocus: true,
      style: { fg: 'white', bg: 'blue', focus: { bg: 'cyan' } },
    });

    // Secret Access Key
    blessed.text({
      parent: overlay,
      top: 5,
      left: 2,
      content: 'Secret Key:',
      style: { fg: 'white', bg: 'black' },
    });
    const secretInput = blessed.textbox({
      parent: overlay,
      top: 5,
      left: 18,
      width: 36,
      height: 1,
      inputOnFocus: true,
      censor: true,
      style: { fg: 'white', bg: 'blue', focus: { bg: 'cyan' } },
    });

    // Region
    blessed.text({
      parent: overlay,
      top: 7,
      left: 2,
      content: 'Region:',
      style: { fg: 'white', bg: 'black' },
    });
    const regionInput = blessed.textbox({
      parent: overlay,
      top: 7,
      left: 18,
      width: 22,
      height: 1,
      inputOnFocus: true,
      value: 'ap-northeast-2',
      style: { fg: 'white', bg: 'blue', focus: { bg: 'cyan' } },
    });

    // Status text
    const statusText = blessed.text({
      parent: overlay,
      top: 9,
      left: 2,
      width: 54,
      content: '',
      tags: true,
      style: { bg: 'black' },
    });

    // Confirm button
    const confirmBtn = blessed.button({
      parent: overlay,
      top: 11,
      left: 8,
      width: 16,
      height: 3,
      content: '  확인 (Enter)',
      border: { type: 'line', fg: 'green' as unknown as number },
      style: {
        fg: 'white',
        bg: 'black',
        border: { fg: 'green' as unknown as number },
        focus: { bg: 'green', fg: 'black' },
        hover: { bg: 'green' },
      },
    });

    // Cancel button
    const cancelBtn = blessed.button({
      parent: overlay,
      top: 11,
      left: 32,
      width: 16,
      height: 3,
      content: '  취소 (Esc)',
      border: { type: 'line', fg: 'red' as unknown as number },
      style: {
        fg: 'white',
        bg: 'black',
        border: { fg: 'red' as unknown as number },
        focus: { bg: 'red', fg: 'black' },
        hover: { bg: 'red' },
      },
    });

    // Tab navigation between fields
    const fields = [keyInput, secretInput, regionInput, confirmBtn, cancelBtn];
    let fieldIdx = 0;
    const focusCurrent = () => { fields[fieldIdx]?.focus(); screen.render(); };

    overlay.key('tab', () => { fieldIdx = (fieldIdx + 1) % fields.length; focusCurrent(); });
    overlay.key('S-tab', () => { fieldIdx = (fieldIdx - 1 + fields.length) % fields.length; focusCurrent(); });
    screen.key('escape', () => { overlay.destroy(); screen.render(); reject(new Error('cancelled')); });

    const submit = async () => {
      const key = keyInput.getValue().trim();
      const secret = secretInput.getValue().trim();
      const region = regionInput.getValue().trim() || 'ap-northeast-2';

      if (!key || !secret) {
        statusText.setContent('{red-fg}Access Key ID와 Secret Key를 모두 입력하세요.{/red-fg}');
        screen.render();
        return;
      }

      statusText.setContent('{yellow-fg}확인 중...{/yellow-fg}');
      screen.render();

      saveCredentials(key, secret, region);

      const identity = await checkCredentials();
      if (identity) {
        statusText.setContent(`{green-fg}✓ 인증 성공! (Account: ${identity.accountId}){/green-fg}`);
        screen.render();
        await new Promise(r => setTimeout(r, 800));
        overlay.destroy();
        screen.render();
        resolve();
      } else {
        statusText.setContent('{red-fg}인증 실패. Key/Secret을 다시 확인하세요.{/red-fg}');
        screen.render();
      }
    };

    confirmBtn.on('press', () => { void submit(); });
    keyInput.key('enter', () => { fieldIdx = 1; focusCurrent(); });
    secretInput.key('enter', () => { fieldIdx = 2; focusCurrent(); });
    regionInput.key('enter', () => { void submit(); });

    screen.render();
    keyInput.focus();
  });
}

// ─── Dashboard ────────────────────────────────────────────────────────────────

function buildDashboard(identity: AwsIdentity): void {
  const grid = new contrib.grid({ rows: 12, cols: 12, screen });

  const projectTable = grid.set(0, 0, 10, 6, contrib.table, {
    keys: true,
    vi: true,
    mouse: true,
    label: ` 프로젝트 목록  {gray-fg}(${identity.accountId}){/gray-fg} `,
    tags: true,
    border: { type: 'line', fg: 'cyan' },
    style: {
      border: { fg: 'cyan' },
      header: { fg: 'yellow', bold: true },
      cell: { fg: 'white', selected: { bg: 'blue', fg: 'white' } },
    },
    columnSpacing: 2,
    columnWidth: [20, 10, 10, 8],
    interactive: true,
  });

  const cpuSparkline = grid.set(0, 6, 4, 6, contrib.sparkline, {
    label: ' CPU 사용률 (7일) ',
    tags: true,
    border: { type: 'line', fg: 'green' },
    style: { fg: 'green', border: { fg: 'green' } },
  });

  const costBar = grid.set(4, 6, 4, 6, contrib.bar, {
    label: ' 프로젝트 비용 (이번 달 $) ',
    barWidth: 6,
    barSpacing: 3,
    maxHeight: 9,
    border: { type: 'line', fg: 'magenta' },
    style: { border: { fg: 'magenta' }, text: 'white', baseline: 'black' },
  });

  const detailBox = grid.set(8, 6, 2, 6, blessed.box, {
    label: ' 상세 정보 ',
    border: { type: 'line', fg: 'yellow' },
    style: { border: { fg: 'yellow' }, fg: 'white' },
    content: '',
    tags: true,
    padding: { left: 1, right: 1 },
  });

  grid.set(10, 0, 2, 12, blessed.box, {
    content:
      ' {cyan-fg}↑↓{/cyan-fg} 이동  {cyan-fg}Enter{/cyan-fg} 선택  {cyan-fg}r{/cyan-fg} 새로고침  {cyan-fg}q{/cyan-fg}/{cyan-fg}Ctrl+C{/cyan-fg} 종료',
    tags: true,
    border: { type: 'line', fg: 'gray' },
    style: { fg: 'gray', border: { fg: 'gray' } },
  });

  type TableWidget = {
    setData: (d: { headers: string[]; data: string[][] }) => void;
    rows: { on: (e: string, cb: () => void) => void; selected: number };
    focus: () => void;
  };
  type SparklineWidget = {
    setData: (titles: string[], data: number[][]) => void;
    setLabel: (label: string) => void;
  };
  type BarWidget = { setData: (d: { titles: string[]; data: number[] }) => void };
  type BoxWidget = { setContent: (s: string) => void };

  let projects: ProjectRecord[] = [];
  let selectedIndex = 0;

  function formatCost(cost: number) { return `$${cost.toFixed(1)}`; }

  function renderProjectTable() {
    const rows = projects.map(p => {
      const cost = getMonthCost(p.projectName);
      const dot = p.ec2InstanceId
        ? p.monthlyBudget !== null && cost > p.monthlyBudget ? '⚠' : '✓'
        : '✗';
      return [p.projectName.slice(0, 18), formatCost(cost), (p.trafficScale ?? '-').slice(0, 8), dot];
    });
    (projectTable as unknown as TableWidget).setData({
      headers: ['프로젝트', '비용/월', '규모', '상태'],
      data: rows.length > 0 ? rows : [['(프로젝트 없음)', '-', '-', '-']],
    });
  }

  function renderCpuSparkline(p: ProjectRecord) {
    const metrics = getMetrics(p.projectName, 168);
    const last48 = metrics.map(m => m.ec2CpuAvg ?? 0).slice(-48);
    const avg = last48.length > 0
      ? (last48.reduce((s, v) => s + v, 0) / last48.length).toFixed(1) : '0';
    const spark = cpuSparkline as unknown as SparklineWidget;
    spark.setData([`CPU % — ${p.projectName}`], [last48.length > 0 ? last48 : [0]]);
    spark.setLabel(` CPU 사용률 — ${p.projectName} (avg: ${avg}%) `);
  }

  function renderCostBar() {
    const labels = projects.slice(0, 8).map(p => p.projectName.slice(0, 8));
    const data = projects.slice(0, 8).map(p => Math.round(getMonthCost(p.projectName) * 10) / 10);
    (costBar as unknown as BarWidget).setData({
      titles: labels.length > 0 ? labels : ['(없음)'],
      data: data.length > 0 ? data : [0],
    });
  }

  function renderDetail(p: ProjectRecord) {
    const cost = getMonthCost(p.projectName);
    const hourly = cost / (new Date().getDate() * 24);
    const over = p.monthlyBudget !== null && cost > p.monthlyBudget;
    const lines = [
      `{yellow-fg}${p.projectName}{/yellow-fg}  {gray-fg}${p.region}{/gray-fg}`,
      `비용: {white-fg}$${cost.toFixed(2)}/월{/white-fg}  시간당: {white-fg}$${hourly.toFixed(4)}{/white-fg}${over ? '  {red-fg}⚠ 예산초과{/red-fg}' : ''}`,
      p.ec2InstanceId ? `EC2: {cyan-fg}${p.ec2InstanceId}{/cyan-fg}` : '{gray-fg}EC2: 없음{/gray-fg}',
      p.rdsInstanceId ? `RDS: {cyan-fg}${p.rdsInstanceId}{/cyan-fg}` : '',
    ].filter(Boolean);
    (detailBox as unknown as BoxWidget).setContent(lines.join('\n'));
  }

  function refresh() {
    projects = listProjects();
    renderProjectTable();
    renderCostBar();
    if (projects.length > 0) {
      const p = projects[selectedIndex] ?? projects[0];
      if (p) { renderCpuSparkline(p); renderDetail(p); }
    } else {
      (cpuSparkline as unknown as SparklineWidget).setData(['CPU'], [[0]]);
      (detailBox as unknown as BoxWidget).setContent(
        '{gray-fg}배포된 프로젝트가 없습니다.\nClaude Code에서 "AWS에 배포해줘" 라고 입력하세요.{/gray-fg}'
      );
    }
    screen.render();
  }

  screen.key('r', () => refresh());
  (projectTable as unknown as TableWidget).rows.on('select', () => {
    selectedIndex = Math.max(0, (projectTable as unknown as TableWidget).rows.selected - 1);
    const p = projects[selectedIndex];
    if (p) { renderCpuSparkline(p); renderDetail(p); screen.render(); }
  });

  setInterval(() => refresh(), 30_000);
  refresh();
  (projectTable as unknown as TableWidget).focus();
  screen.render();
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  // Show "checking..." overlay
  const loadingBox = blessed.box({
    parent: screen,
    top: 'center',
    left: 'center',
    width: 40,
    height: 5,
    border: { type: 'line', fg: 'cyan' as unknown as number },
    content: '\n  {cyan-fg}AWS credentials 확인 중...{/cyan-fg}',
    tags: true,
    style: { bg: 'black', border: { fg: 'cyan' } },
  });
  screen.render();

  const identity = await checkCredentials();
  loadingBox.destroy();

  if (identity) {
    buildDashboard(identity);
  } else {
    try {
      await showAuthForm();
      const newIdentity = await checkCredentials();
      if (newIdentity) {
        buildDashboard(newIdentity);
      } else {
        screen.destroy();
        console.error('AWS 인증에 실패했습니다.');
        process.exit(1);
      }
    } catch {
      screen.destroy();
      console.log('인증을 취소했습니다.');
      process.exit(0);
    }
  }
}

void main();
