import type { KnowledgePoint, QuestionLabel } from '../types';

// ── Volume / Chapter ordering ─────────────────────────────────────────────

export const VOLUME_COLORS: Record<string, string> = {
  '必修 第一册': '#4C78A8', '必修 第二册': '#F58518', '必修 第三册': '#E45756',
  '选择性必修 第一册': '#72B7B2', '选择性必修 第二册': '#54A24B', '选择性必修 第三册': '#B279A2',
};
export const VOLUME_ORDER: Record<string, number> = {
  '必修 第一册': 1, '必修 第二册': 2, '必修 第三册': 3,
  '选择性必修 第一册': 4, '选择性必修 第二册': 5, '选择性必修 第三册': 6,
};
export const CHAPTER_ORDER: Record<string, number> = {
  '第一章 运动的描述': 1, '第二章 匀变速直线运动的研究': 2, '第三章 相互作用——力': 3, '第四章 运动和力的关系': 4,
  '第五章 抛体运动': 5, '第六章 圆周运动': 6, '第七章 万有引力与宇宙航行': 7, '第八章 机械能守恒定律': 8,
  '第九章 静电场及其应用': 9, '第十章 静电场中的能量': 10, '第十一章 电路及其应用': 11, '第十二章 电能 能量守恒定律': 12, '第十三章 电磁感应与电磁波初步': 13,
  '第一章 动量守恒定律': 14, '第二章 机械振动': 15, '第三章 机械波': 16, '第四章 光': 17,
  '第一章 安培力与洛伦兹力': 18, '第二章 电磁感应': 19, '第三章 交变电流': 20, '第四章 电磁振荡与电磁波': 21, '第五章 传感器': 22,
  '第一章 分子动理论': 23, '第二章 气体、固体和液体': 24, '第三章 热力学定律': 25, '第四章 原子结构和波粒二象性': 26, '第五章 原子核': 27,
};

const CHN = ['', '一', '二', '三', '四', '五', '六', '七', '八', '九', '十'];

export function chapterLabel(ch: string): string {
  // DB values now include "第X章" prefix; return as-is when already formatted
  if (/^第[一二三四五六七八九十]/.test(ch)) return ch;
  const ord = CHAPTER_ORDER[ch];
  if (!ord) return ch;
  const prefix = ord <= 10 ? CHN[ord] : String(ord);
  return `第${prefix}章 ${ch}`;
}

// ── Question type labels ───────────────────────────────────────────────────

export const TYPE_LABELS: Record<string, string> = {
  single_choice: '单选题', multiple_choice: '多选题',
  true_false: '判断题', fill_in_blank: '填空题',
  knowledge_fill_in_blank: '知识点填空', experiment: '实验题',
  graph_construction: '作图题', problem_solving: '解答题',
  comprehensive: '综合题',
};

// ── Difficulty tier labels ─────────────────────────────────────────────────

export const TIER_LABELS: Record<string, string> = {
  easy: '容易', moderate_easy: '较易', medium: '适中',
  moderate_hard: '较难', hard: '困难',
};

export const TIER_ORDER = ['easy', 'moderate_easy', 'medium', 'moderate_hard', 'hard'] as const;

export const TIER_COLORS: Record<string, string> = {
  easy: '#52c41a', moderate_easy: '#73d13d', medium: '#faad14',
  moderate_hard: '#ff7a45', hard: '#ff4d4f',
};

// ── Status labels ──────────────────────────────────────────────────────────

export const STATUS_LABELS: Record<string, string> = {
  draft: '草稿', pending_review: '待审核', approved: '已通过',
  calibrating: '校准中', retired: '已退役',
};

export const STATUS_COLORS: Record<string, string> = {
  draft: '#999', pending_review: '#d4920b', approved: '#52796d',
  calibrating: '#1890ff', retired: '#ff4d4f',
};

// ── Label type display names ───────────────────────────────────────────────

export const LABEL_TYPE_LABELS: Record<string, string> = {
  knowledge_point: '知识点', question_type: '题型',
  ability_dimension: '能力维度', core_literacy: '核心素养',
  physics_model: '物理模型', misconception: '常见误区',
  question_structure: '题目结构', solution_strategy: '解法策略',
  math_prerequisite: '数学前置',
};

// ── Ability dimension ──────────────────────────────────────────────────────

export const ABILITY_LABELS: Record<string, string> = {
  remember: '记忆', understand: '理解', apply: '应用',
  analyze: '分析', evaluate: '评价', create: '创造',
};

// ── Question structure ─────────────────────────────────────────────────────

export const STRUCTURE_LABELS: Record<string, string> = {
  single_concept: '单一概念', multi_concept: '多概念综合',
  model_application: '模型应用', real_world: '真实情境',
  experiment: '实验探究', graph_reading: '图像分析',
  concept_comparison: '概念比较', multi_step: '多步骤推理',
  real_world_application: '真实情境应用', graphical_analysis: '图像分析',
  experimental_design: '实验设计',
};

// ── Solution strategy ──────────────────────────────────────────────────────

export const SOLUTION_LABELS: Record<string, string> = {
  isolation: '隔离法', integral: '整体法', graph_method: '图像法',
  proportional: '比例法', extreme_value: '极值法', vector_decomposition: '矢量分解',
  energy_conservation: '能量守恒', momentum_conservation: '动量守恒',
  kinematic_equation: '运动学公式', dimensional_analysis: '量纲分析',
  concept_analysis: '概念分析', formula_application: '公式应用',
  graphical_analysis: '图像分析', extreme_value_analysis: '极值分析',
  process_segmentation: '过程分段', proportional_reasoning: '比例推理',
};

// ── Math prerequisite ──────────────────────────────────────────────────────

export const MATH_LABELS: Record<string, string> = {
  linear_equation: '一元一次方程', quadratic_equation: '一元二次方程',
  trigonometry: '三角函数', vector_math: '向量运算',
  proportional_reasoning: '比例推理', graph_slope_area: '图像斜率/面积',
  simultaneous_equations: '联立方程组', inequality: '不等式',
  max_min: '求极值', unit_conversion: '单位换算',
  algebra: '代数', geometry: '几何', vector: '向量', calculus: '微积分',
  none: '无',
};

// ── Core literacy ──────────────────────────────────────────────────────────

export const CORE_LITERACY_LABELS: Record<string, string> = {
  matter_view: '物质观', motion_interaction_view: '运动与相互作用观',
  energy_view: '能量观', model_construction: '模型建构',
  scientific_reasoning: '科学推理', scientific_argumentation: '科学论证',
  critical_innovation: '质疑创新', problem_awareness: '问题意识',
  evidence_collection: '证据获取', interpretation_communication: '解释与交流',
  scientific_essence: '科学本质', truth_seeking: '实事求是',
  social_responsibility: '社会责任',
};

// ── Physics model ──────────────────────────────────────────────────────────

export const PHYSICS_MODEL_LABELS: Record<string, string> = {
  particle: '质点', inclined_plane: '斜面', free_body_diagram: '受力分析图',
  pulley_system: '滑轮系统', connected_body: '连接体', conveyor_belt: '传送带',
  projectile: '抛体', uniform_circular_motion: '匀速圆周运动',
  spring_mass: '弹簧振子', collision: '碰撞模型',
  reference_frame: '参考系模型', displacement: '位移与时间模型',
  time_interval: '时间间隔', velocity: '速度', acceleration: '加速度',
  velocity_acceleration: '速度-加速度模型', uniform_acceleration: '匀变速直线运动模型',
  free_fall: '自由落体模型', graph_motion: '运动图像模型',
  force: '力', force_analysis: '受力分析模型', friction: '摩擦模型',
  elasticity: '弹力模型', motion_interaction: '运动与相互作用',
  equilibrium: '平衡模型', newton_first: '牛顿第一定律模型',
  newton_second: '牛顿第二定律模型', newton_third: '牛顿第三定律模型',
  circular_motion: '圆周运动模型', energy: '能量模型', momentum: '动量模型',
  electric_field: '电场模型', circuit: '闭合电路模型',
  magnetic_field: '磁场模型', magnetic_lorentz: '带电粒子磁场运动模型',
  electromagnetic_induction: '电磁感应模型', ac: '交流电与变压器模型',
  oscillation: '振动模型', wave: '机械波模型', optics: '光学成像模型',
  atomic_nuclear: '原子与核模型',
};

// ── Misconception ──────────────────────────────────────────────────────────

export const MISCONCEPTION_LABELS: Record<string, string> = {
  miscon_x_t_curved_path: 'x-t图曲线=曲线运动',
  miscon_flat_line_as_constant_speed: '水平线=匀速运动',
  concept_misunderstanding: '概念理解错误',
  model_selection: '模型选择错误',
  condition_extraction: '条件识别错误',
  diagram_analysis: '图像分析错误',
  force_analysis: '受力分析错误',
  equation_setup: '方程建立错误',
  calculation: '数学处理错误',
  unit_direction: '单位或方向错误',
  expression_norm: '表达不规范',
};

// ── Label grouping for display ─────────────────────────────────────────────

export const LABEL_GROUPS: { key: string; title: string; types: string[] }[] = [
  { key: 'attributes', title: '题目属性', types: ['question_type', 'question_structure'] },
  { key: 'knowledge', title: '知识点', types: ['knowledge_point'] },
  { key: 'cognitive', title: '认知维度', types: ['ability_dimension', 'core_literacy'] },
  { key: 'solution', title: '解题要素', types: ['physics_model', 'solution_strategy', 'math_prerequisite'] },
  { key: 'diagnosis', title: '诊断信息', types: ['misconception'] },
];

// ── Helper functions ───────────────────────────────────────────────────────

export function getLabelDisplayName(l: QuestionLabel, kpMap: Record<string, KnowledgePoint>) {
  if (l.label_type === 'knowledge_point') return kpMap[l.label_id]?.name || l.label_id;
  if (l.label_type === 'question_type') return TYPE_LABELS[l.label_id] || l.label_id;
  if (l.label_type === 'core_literacy') return CORE_LITERACY_LABELS[l.label_id] || l.label_id;
  if (l.label_type === 'solution_strategy') return SOLUTION_LABELS[l.label_id] || l.label_id;
  if (l.label_type === 'math_prerequisite') return MATH_LABELS[l.label_id] || l.label_id;
  if (l.label_type === 'ability_dimension') return ABILITY_LABELS[l.label_id] || l.label_id;
  if (l.label_type === 'question_structure') return STRUCTURE_LABELS[l.label_id] || l.label_id;
  if (l.label_type === 'physics_model') return PHYSICS_MODEL_LABELS[l.label_id] || l.label_id;
  if (l.label_type === 'misconception') return MISCONCEPTION_LABELS[l.label_id] || l.label_id;
  return l.label_id;
}

export function getLabelColor(type: string) {
  if (type === 'misconception') return '#fff2f0';
  if (type === 'physics_model') return '#f9f0ff';
  if (type === 'ability_dimension') return '#f6ffed';
  if (type === 'question_structure') return '#fff7e6';
  if (type === 'question_type') return '#e6fffb';
  if (type === 'core_literacy') return '#fff0f6';
  if (type === 'solution_strategy') return '#f0f5ff';
  if (type === 'math_prerequisite') return '#fffbe6';
  return '#e6f7ff';
}
