from dataclasses import dataclass, field


@dataclass(frozen=True)
class PhysicsModelDefinition:
    id: str
    name: str
    domain: str
    layer: str
    description: str
    core_equations: list[str] = field(default_factory=list)
    typical_errors: list[str] = field(default_factory=list)
    prerequisites: list[str] = field(default_factory=list)
    transfer_targets: list[str] = field(default_factory=list)
    keywords: list[str] = field(default_factory=list)


PHYSICS_MODELS: list[PhysicsModelDefinition] = [
    PhysicsModelDefinition(
        id="particle",
        name="质点模型",
        domain="力学",
        layer="对象抽象",
        description="忽略物体大小和形状，只保留质量与运动状态，是建立运动学和动力学模型的入口。",
        typical_errors=["没有判断能否忽略形状", "把研究对象和参照物混淆"],
        transfer_targets=["reference_frame", "displacement"],
        keywords=["质点", "研究对象"],
    ),
    PhysicsModelDefinition(
        id="reference_frame",
        name="参考系模型",
        domain="力学",
        layer="运动描述",
        description="明确观察运动的参考对象，保证位移、速度、加速度描述有共同基准。",
        prerequisites=["particle"],
        transfer_targets=["displacement", "velocity_acceleration"],
        keywords=["参考系", "参照物", "相对运动"],
    ),
    PhysicsModelDefinition(
        id="displacement",
        name="位移与时间模型",
        domain="力学",
        layer="运动描述",
        description="用位置变化、时间间隔描述运动过程，是图像和匀变速模型的基础。",
        core_equations=["x=\\Delta r", "v=\\frac{\\Delta x}{\\Delta t}"],
        prerequisites=["reference_frame"],
        transfer_targets=["velocity_acceleration", "uniform_acceleration"],
        keywords=["位移", "路程", "时间", "位置"],
    ),
    PhysicsModelDefinition(
        id="velocity_acceleration",
        name="速度-加速度模型",
        domain="力学",
        layer="运动描述",
        description="用速度描述运动快慢和方向，用加速度描述速度变化，是判断运动规律的核心。",
        core_equations=["a=\\frac{\\Delta v}{\\Delta t}"],
        prerequisites=["displacement"],
        transfer_targets=["uniform_acceleration", "graph_motion"],
        keywords=["速度", "加速度", "平均速度", "瞬时速度"],
    ),
    PhysicsModelDefinition(
        id="uniform_acceleration",
        name="匀变速直线运动模型",
        domain="力学",
        layer="运动模型",
        description="加速度恒定的一维运动模型，重点是方程组、图像、方向和时间平方关系。",
        core_equations=["v=v_0+at", "x=v_0t+\\frac{1}{2}at^2", "v^2-v_0^2=2ax"],
        typical_errors=["漏写时间平方", "方向符号混乱", "把平均速度公式误用到非匀变速"],
        prerequisites=["velocity_acceleration"],
        transfer_targets=["free_fall", "projectile", "newton_second"],
        keywords=["匀变速", "直线运动", "刹车", "追及", "相遇"],
    ),
    PhysicsModelDefinition(
        id="free_fall",
        name="自由落体模型",
        domain="力学",
        layer="运动模型",
        description="初速度为零、只受重力的匀加速直线运动，是匀变速模型在竖直方向的典型化。",
        core_equations=["v=gt", "h=\\frac{1}{2}gt^2", "v^2=2gh"],
        typical_errors=["把 h 写成 gt", "忽略初速度条件", "方向和正负号处理错误"],
        prerequisites=["uniform_acceleration"],
        transfer_targets=["projectile", "newton_second"],
        keywords=["自由落体", "竖直下落", "重力加速度"],
    ),
    PhysicsModelDefinition(
        id="projectile",
        name="抛体运动模型",
        domain="力学",
        layer="运动模型",
        description="把二维运动分解为水平匀速和竖直匀变速，训练分解、合成和过程意识。",
        core_equations=["x=v_0t", "y=v_{0y}t-\\frac{1}{2}gt^2"],
        typical_errors=["没有分解运动", "水平和竖直时间不统一", "把速度方向当位移方向"],
        prerequisites=["uniform_acceleration"],
        transfer_targets=["circular_motion", "energy"],
        keywords=["平抛", "斜抛", "抛体"],
    ),
    PhysicsModelDefinition(
        id="graph_motion",
        name="运动图像模型",
        domain="力学",
        layer="表征转换",
        description="用 x-t、v-t、a-t 图像表达运动，核心是斜率、面积、截距和交点的物理意义。",
        typical_errors=["混淆 x-t 和 v-t 斜率", "忘记 v-t 面积表示位移", "把图像交点解释错"],
        prerequisites=["velocity_acceleration"],
        transfer_targets=["uniform_acceleration"],
        keywords=["图像", "v-t", "x-t", "斜率", "面积"],
    ),
    PhysicsModelDefinition(
        id="force_analysis",
        name="受力分析模型",
        domain="力学",
        layer="相互作用",
        description="明确研究对象，逐个找力并画受力图，是动力学、平衡、圆周和能量问题的共同入口。",
        typical_errors=["漏力或多力", "作用对象错误", "摩擦力方向判断错误"],
        transfer_targets=["equilibrium", "newton_second", "friction"],
        keywords=["受力", "力", "力的分解", "受力图"],
    ),
    PhysicsModelDefinition(
        id="friction",
        name="摩擦模型",
        domain="力学",
        layer="相互作用",
        description="区分静摩擦和滑动摩擦，先判断相对运动或相对运动趋势，再判断大小和方向。",
        core_equations=["f=\\mu N"],
        typical_errors=["静摩擦直接套 f=μN", "摩擦力方向凭直觉判断"],
        prerequisites=["force_analysis"],
        transfer_targets=["equilibrium", "newton_second"],
        keywords=["摩擦", "粗糙", "静摩擦", "滑动摩擦"],
    ),
    PhysicsModelDefinition(
        id="elasticity",
        name="弹力模型",
        domain="力学",
        layer="相互作用",
        description="分析接触、形变和弹簧弹力，常与平衡和牛顿第二定律结合。",
        core_equations=["F=kx"],
        prerequisites=["force_analysis"],
        transfer_targets=["equilibrium", "oscillation"],
        keywords=["弹力", "弹簧", "胡克定律"],
    ),
    PhysicsModelDefinition(
        id="equilibrium",
        name="平衡模型",
        domain="力学",
        layer="动力学",
        description="合力为零或力矩平衡，核心是受力完整、方向分解和方程数量匹配。",
        core_equations=["\\sum F=0"],
        typical_errors=["方程数量不足", "分解方向不合理", "把平衡和匀速混为一谈"],
        prerequisites=["force_analysis"],
        transfer_targets=["newton_second", "energy"],
        keywords=["平衡", "静止", "匀速", "共点力"],
    ),
    PhysicsModelDefinition(
        id="newton_first",
        name="牛顿第一定律模型",
        domain="力学",
        layer="动力学",
        description="从惯性角度理解力和运动状态变化的关系，纠正“有力才运动”的直觉误区。",
        prerequisites=["force_analysis"],
        transfer_targets=["newton_second"],
        keywords=["惯性", "牛顿第一定律"],
    ),
    PhysicsModelDefinition(
        id="newton_second",
        name="牛顿第二定律模型",
        domain="力学",
        layer="动力学",
        description="把受力分析和运动学方程连接起来，是高中物理最核心的动力学模型。",
        core_equations=["\\sum F=ma"],
        typical_errors=["研究对象不一致", "合力方向与加速度方向不一致", "先套公式后受力"],
        prerequisites=["force_analysis", "uniform_acceleration"],
        transfer_targets=["circular_motion", "energy", "momentum"],
        keywords=["牛顿第二定律", "动力学", "加速度", "合力"],
    ),
    PhysicsModelDefinition(
        id="newton_third",
        name="牛顿第三定律模型",
        domain="力学",
        layer="动力学",
        description="识别作用力与反作用力，区分一对相互作用力和一对平衡力。",
        prerequisites=["force_analysis"],
        transfer_targets=["newton_second", "momentum"],
        keywords=["牛顿第三定律", "作用力", "反作用力"],
    ),
    PhysicsModelDefinition(
        id="circular_motion",
        name="圆周运动模型",
        domain="力学",
        layer="曲线运动",
        description="用向心加速度和向心力刻画方向不断变化的运动，重点是“向心力不是新性质的力”。",
        core_equations=["a_n=\\frac{v^2}{r}=\\omega^2r", "F_n=m\\frac{v^2}{r}"],
        typical_errors=["把向心力当成额外的力", "半径、速度、角速度关系混乱"],
        prerequisites=["newton_second"],
        transfer_targets=["energy", "magnetic_lorentz"],
        keywords=["圆周", "向心", "角速度"],
    ),
    PhysicsModelDefinition(
        id="energy",
        name="能量模型",
        domain="力学",
        layer="守恒与转化",
        description="从做功和能量转化看过程，适合处理路径复杂但能量关系清楚的问题。",
        core_equations=["W=\\Delta E_k", "E_{k1}+E_{p1}=E_{k2}+E_{p2}"],
        typical_errors=["漏掉非保守力做功", "零势能面选择混乱", "把力学能守恒条件用错"],
        prerequisites=["force_analysis"],
        transfer_targets=["momentum", "electric_field"],
        keywords=["能量", "动能", "势能", "机械能", "做功"],
    ),
    PhysicsModelDefinition(
        id="momentum",
        name="动量模型",
        domain="力学",
        layer="守恒与转化",
        description="从相互作用前后系统动量变化看问题，适合碰撞、爆炸、反冲等短时强相互作用。",
        core_equations=["p=mv", "\\Delta p=Ft", "\\sum p_{before}=\\sum p_{after}"],
        typical_errors=["系统选取错误", "方向符号混乱", "把动量守恒条件用错"],
        prerequisites=["newton_third"],
        transfer_targets=["energy"],
        keywords=["动量", "冲量", "碰撞", "反冲"],
    ),
    PhysicsModelDefinition(
        id="electric_field",
        name="电场模型",
        domain="电磁学",
        layer="场与相互作用",
        description="用场强、电势、电势能描述电荷间作用，把力学中的受力和能量迁移到电场情境。",
        core_equations=["E=\\frac{F}{q}", "W=qU"],
        prerequisites=["force_analysis", "energy"],
        transfer_targets=["circuit", "magnetic_field"],
        keywords=["电场", "场强", "电势", "电势能"],
    ),
    PhysicsModelDefinition(
        id="circuit",
        name="闭合电路模型",
        domain="电磁学",
        layer="电路",
        description="从电流、电压、电阻和能量转化理解电路，强调局部元件与整体回路的关系。",
        core_equations=["I=\\frac{U}{R}", "E=U+Ir"],
        prerequisites=["electric_field"],
        transfer_targets=["electromagnetic_induction"],
        keywords=["电路", "欧姆定律", "电源", "电阻"],
    ),
    PhysicsModelDefinition(
        id="magnetic_field",
        name="磁场模型",
        domain="电磁学",
        layer="场与相互作用",
        description="描述磁场对电流和运动电荷的作用，是安培力、洛伦兹力和电磁感应的基础。",
        prerequisites=["electric_field", "force_analysis"],
        transfer_targets=["magnetic_lorentz", "electromagnetic_induction"],
        keywords=["磁场", "磁感应强度", "安培力"],
    ),
    PhysicsModelDefinition(
        id="magnetic_lorentz",
        name="带电粒子磁场运动模型",
        domain="电磁学",
        layer="场中运动",
        description="洛伦兹力提供向心力，连接磁场、圆周运动和粒子轨迹分析。",
        core_equations=["qvB=m\\frac{v^2}{r}"],
        prerequisites=["magnetic_field", "circular_motion"],
        transfer_targets=["electromagnetic_induction"],
        keywords=["洛伦兹力", "带电粒子", "磁场中运动"],
    ),
    PhysicsModelDefinition(
        id="electromagnetic_induction",
        name="电磁感应模型",
        domain="电磁学",
        layer="变化与守恒",
        description="用磁通量变化、感应电动势和能量守恒分析变化电磁过程。",
        core_equations=["\\mathcal{E}=\\frac{\\Delta \\Phi}{\\Delta t}"],
        typical_errors=["磁通量变化判断错误", "楞次定律方向错误", "电路和力学过程割裂"],
        prerequisites=["magnetic_field", "circuit"],
        transfer_targets=["ac"],
        keywords=["电磁感应", "磁通量", "楞次定律", "法拉第"],
    ),
    PhysicsModelDefinition(
        id="ac",
        name="交流电与变压器模型",
        domain="电磁学",
        layer="变化与应用",
        description="用周期变化和有效值理解交流电，用能量守恒理解理想变压器。",
        prerequisites=["electromagnetic_induction", "circuit"],
        keywords=["交流电", "变压器", "有效值"],
    ),
    PhysicsModelDefinition(
        id="oscillation",
        name="振动模型",
        domain="波与近代",
        layer="周期过程",
        description="把往复运动抽象为周期、频率、回复力和能量变化。",
        prerequisites=["elasticity", "energy"],
        transfer_targets=["wave"],
        keywords=["振动", "简谐运动", "周期"],
    ),
    PhysicsModelDefinition(
        id="wave",
        name="机械波模型",
        domain="波与近代",
        layer="传播过程",
        description="把振动传播到空间，关注波速、波长、频率和图像读法。",
        core_equations=["v=\\lambda f"],
        prerequisites=["oscillation"],
        transfer_targets=["optics"],
        keywords=["机械波", "波长", "频率", "波速"],
    ),
    PhysicsModelDefinition(
        id="optics",
        name="光学成像模型",
        domain="波与近代",
        layer="传播过程",
        description="用光线、反射、折射和成像关系分析光传播。",
        keywords=["光学", "折射", "反射", "成像"],
    ),
    PhysicsModelDefinition(
        id="atomic_nuclear",
        name="原子与核模型",
        domain="波与近代",
        layer="微观结构",
        description="用能级、光子、核反应和守恒观点理解微观过程。",
        prerequisites=["energy", "momentum"],
        keywords=["原子", "能级", "光子", "核反应"],
    ),
]

MODEL_BY_ID = {model.id: model for model in PHYSICS_MODELS}

MODEL_ALIASES = {
    "time_interval": "displacement",
    "velocity": "velocity_acceleration",
    "acceleration": "velocity_acceleration",
    "force": "force_analysis",
    "motion_interaction": "force_analysis",
    "newton_laws": "newton_second",
    "work_energy": "energy",
    "mechanical_energy": "energy",
    "electric_potential": "electric_field",
    "capacitor": "electric_field",
    "dc_circuit": "circuit",
    "ampere_force": "magnetic_field",
    "lorentz_force": "magnetic_lorentz",
    "transformer": "ac",
    "mechanical_wave": "wave",
    "geometric_optics": "optics",
    "gas_model": "atomic_nuclear",
}


def canonical_model_id(model_id: str | None) -> str | None:
    if not model_id:
        return None
    return MODEL_ALIASES.get(model_id, model_id)


def model_name(model_id: str | None) -> str:
    canonical = canonical_model_id(model_id)
    if canonical in MODEL_BY_ID:
        return MODEL_BY_ID[canonical].name
    return model_id or ""


def related_model_ids(model_id: str | None) -> list[str]:
    canonical = canonical_model_id(model_id)
    if canonical not in MODEL_BY_ID:
        return []
    model = MODEL_BY_ID[canonical]
    related = [*model.prerequisites, *model.transfer_targets]
    for candidate in PHYSICS_MODELS:
        if canonical in candidate.prerequisites or canonical in candidate.transfer_targets:
            related.append(candidate.id)
    return list(dict.fromkeys(related))


def infer_model_ids_from_kp(
    kp_name: str | None,
    chapter: str | None = None,
    section: str | None = None,
) -> list[str]:
    text = " ".join(part or "" for part in (kp_name, chapter, section))
    if not text.strip():
        return []

    matches: list[str] = []
    for model in PHYSICS_MODELS:
        if any(keyword and keyword in text for keyword in model.keywords):
            matches.append(model.id)

    if "自由落体" in text and "uniform_acceleration" not in matches:
        matches.append("uniform_acceleration")
    if ("牛顿" in text or "动力学" in text) and "force_analysis" not in matches:
        matches.append("force_analysis")
    if ("电磁感应" in text or "楞次" in text) and "circuit" not in matches:
        matches.append("circuit")

    return list(dict.fromkeys(matches))
