/* eslint-disable @typescript-eslint/no-require-imports */
const blessed = require('blessed') as typeof import('blessed');
const contrib = require('blessed-contrib') as {
  grid: new (opts: { rows: number; cols: number; screen: ReturnType<typeof blessed.screen> }) => {
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

// ─── Screen ───────────────────────────────────────────────────────────────────

const screen = blessed.screen({
  smartCSR: true,
  title: 'AWS Cost Optimizer HUD',
  fullUnicode: true,
});

// ─── Layout grid ─────────────────────────────────────────────────────────────

const grid = new contrib.grid({ rows: 12, cols: 12, screen });

// Project list — left half
const projectTable = grid.set(0, 0, 10, 6, contrib.table, {
  keys: true,
  vi: true,
  mouse: true,
  label: ' 프로젝트 목록 ',
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

// CPU sparkline — right top
const cpuSparkline = grid.set(0, 6, 4, 6, contrib.sparkline, {
  label: ' CPU 사용률 (7일) ',
  tags: true,
  border: { type: 'line', fg: 'green' },
  style: { fg: 'green', border: { fg: 'green' } },
});

// Cost bar — right middle
const costBar = grid.set(4, 6, 4, 6, contrib.bar, {
  label: ' 프로젝트 비용 (이번 달 $) ',
  barWidth: 6,
  barSpacing: 3,
  maxHeight: 9,
  border: { type: 'line', fg: 'magenta' },
  style: { border: { fg: 'magenta' }, text: 'white', baseline: 'black' },
});

// Detail box — right bottom
const detailBox = grid.set(8, 6, 2, 6, blessed.box, {
  label: ' 상세 정보 ',
  border: { type: 'line', fg: 'yellow' },
  style: { border: { fg: 'yellow' }, fg: 'white' },
  content: '',
  tags: true,
  padding: { left: 1, right: 1 },
});

// Status bar
grid.set(10, 0, 2, 12, blessed.box, {
  content:
    ' {cyan-fg}↑↓{/cyan-fg} 이동  {cyan-fg}Enter{/cyan-fg} 선택  {cyan-fg}r{/cyan-fg} 새로고침  {cyan-fg}q{/cyan-fg}/{cyan-fg}Ctrl+C{/cyan-fg} 종료',
  tags: true,
  border: { type: 'line', fg: 'gray' },
  style: { fg: 'gray', border: { fg: 'gray' } },
});

// ─── State ────────────────────────────────────────────────────────────────────

let projects: ProjectRecord[] = [];
let selectedIndex = 0;

// ─── Typed helpers ────────────────────────────────────────────────────────────

type TableWidget = {
  setData: (d: { headers: string[]; data: string[][] }) => void;
  rows: { on: (e: string, cb: () => void) => void; selected: number };
  focus: () => void;
};

type SparklineWidget = {
  setData: (titles: string[], data: number[][]) => void;
  setLabel: (label: string) => void;
};

type BarWidget = {
  setData: (d: { titles: string[]; data: number[] }) => void;
};

type BoxWidget = {
  setContent: (s: string) => void;
};

// ─── Rendering ───────────────────────────────────────────────────────────────

function formatCost(cost: number): string {
  return `$${cost.toFixed(1)}`;
}

function renderProjectTable(): void {
  const headers = ['프로젝트', '비용/월', '규모', '상태'];
  const rows = projects.map(p => {
    const cost = getMonthCost(p.projectName);
    const dot =
      p.ec2InstanceId
        ? p.monthlyBudget !== null && cost > p.monthlyBudget
          ? '⚠'
          : '✓'
        : '✗';
    return [
      p.projectName.slice(0, 18),
      formatCost(cost),
      (p.trafficScale ?? '-').slice(0, 8),
      dot,
    ];
  });

  (projectTable as unknown as TableWidget).setData({
    headers,
    data: rows.length > 0 ? rows : [['(프로젝트 없음)', '-', '-', '-']],
  });
}

function renderCpuSparkline(project: ProjectRecord): void {
  const metrics = getMetrics(project.projectName, 168);
  const cpuValues = metrics.map(m => m.ec2CpuAvg ?? 0);
  const last48 = cpuValues.slice(-48);
  const avg =
    last48.length > 0
      ? (last48.reduce((s, v) => s + v, 0) / last48.length).toFixed(1)
      : '0';

  const sparkWidget = cpuSparkline as unknown as SparklineWidget;
  sparkWidget.setData(
    [`CPU % — ${project.projectName}`],
    [last48.length > 0 ? last48 : [0]]
  );
  sparkWidget.setLabel(
    ` CPU 사용률 — ${project.projectName} (avg: ${avg}%) `
  );
}

function renderCostBar(): void {
  const labels = projects.slice(0, 8).map(p => p.projectName.slice(0, 8));
  const data = projects.slice(0, 8).map(p => Math.round(getMonthCost(p.projectName) * 10) / 10);

  (costBar as unknown as BarWidget).setData({
    titles: labels.length > 0 ? labels : ['(없음)'],
    data: data.length > 0 ? data : [0],
  });
}

function renderDetail(project: ProjectRecord): void {
  const cost = getMonthCost(project.projectName);
  const hourly = cost / (new Date().getDate() * 24);
  const overBudget = project.monthlyBudget !== null && cost > project.monthlyBudget;

  const lines = [
    `{yellow-fg}${project.projectName}{/yellow-fg}  {gray-fg}${project.region}{/gray-fg}`,
    `비용: {white-fg}$${cost.toFixed(2)}/월{/white-fg}  시간당: {white-fg}$${hourly.toFixed(4)}{/white-fg}${overBudget ? '  {red-fg}⚠ 예산초과{/red-fg}' : ''}`,
    project.ec2InstanceId ? `EC2: {cyan-fg}${project.ec2InstanceId}{/cyan-fg}` : '{gray-fg}EC2: 없음{/gray-fg}',
    project.rdsInstanceId ? `RDS: {cyan-fg}${project.rdsInstanceId}{/cyan-fg}` : '',
  ].filter(Boolean);

  (detailBox as unknown as BoxWidget).setContent(lines.join('\n'));
}

function refresh(): void {
  projects = listProjects();
  renderProjectTable();
  renderCostBar();

  if (projects.length > 0) {
    const selected = projects[selectedIndex] ?? projects[0];
    if (selected) {
      renderCpuSparkline(selected);
      renderDetail(selected);
    }
  } else {
    (cpuSparkline as unknown as SparklineWidget).setData(['CPU'], [[0]]);
    (detailBox as unknown as BoxWidget).setContent(
      '{gray-fg}배포된 프로젝트가 없습니다.\nClaude Code에서 "AWS에 배포해줘" 라고 입력하세요.{/gray-fg}'
    );
  }

  screen.render();
}

// ─── Key Bindings ─────────────────────────────────────────────────────────────

screen.key(['q', 'C-c'], () => process.exit(0));
screen.key('r', () => {
  refresh();
});

(projectTable as unknown as TableWidget).rows.on('select', () => {
  const table = projectTable as unknown as TableWidget;
  selectedIndex = Math.max(0, table.rows.selected - 1);
  const p = projects[selectedIndex];
  if (p) {
    renderCpuSparkline(p);
    renderDetail(p);
    screen.render();
  }
});

// ─── Auto-refresh every 30s ───────────────────────────────────────────────────

setInterval(() => refresh(), 30_000);

// ─── Start ────────────────────────────────────────────────────────────────────

refresh();
(projectTable as unknown as TableWidget).focus();
screen.render();
