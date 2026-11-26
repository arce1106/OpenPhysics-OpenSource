#!/usr/bin/env python3
"""
Generate comprehensive knowledge graph relations for v2, v3, x1, x2, x3.

Merges with existing v1 relations. Safe to re-run — deduplicates by (source, target, type).
"""

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SEED_DIR = ROOT / "app" / "seed"


def define_relations():
    """Returns list of (source_id, target_id, relation_type, reason) tuples."""
    rels = []

    # =========================================================================
    # 必修第二册 (v2) — 抛体运动 / 圆周运动 / 万有引力 / 机械能
    # =========================================================================

    # ── 第五章 抛体运动 ── 内部前置链 ──
    v2_ch5 = [
        ("v2c5s1k01", "v2c5s1k03", "prerequisite_of", "速度方向沿切线 → 方向不断变化 → 必为变速运动"),
        ("v2c5s1k01", "v2c5s2k01", "prerequisite_of", "切线方向的速度是运动合成与分解的基础"),
        ("v2c5s1k02", "v2c5s1k04", "prerequisite_of", "曲线运动条件(合力与速度不共线) → 合力指向轨迹凹侧"),
        ("v2c5s2k01", "v2c5s2k02", "prerequisite_of", "合运动与分运动概念 → 位移、速度、加速度的矢量合成"),
        ("v2c5s2k02", "v2c5s2k04", "prerequisite_of", "速度矢量的合成分解 → 小船过河模型"),
        ("v2c5s2k02", "v2c5s2k05", "prerequisite_of", "速度矢量的合成分解 → 绳端速度分解"),
        ("v2c5s2k03", "v2c5s4k01", "prerequisite_of", "运动独立性原理 → 平抛运动可分解为水平匀速+竖直自由落体"),
        ("v2c5s2k01", "v2c5s4k01", "prerequisite_of", "合运动与分运动概念是理解平抛运动分解的前提"),
        ("v2c5s3k01", "v2c5s3k02", "prerequisite_of", "平抛实验思想 → 数据处理方法"),
        ("v2c5s3k01", "v2c5s3k04", "prerequisite_of", "平抛实验思想 → 初速度测量"),
        ("v2c5s4k01", "v2c5s4k02", "prerequisite_of", "平抛分解思想 → 基本公式推导"),
        ("v2c5s4k02", "v2c5s4k03", "prerequisite_of", "平抛公式 → 飞行时间仅由高度决定"),
        ("v2c5s4k02", "v2c5s4k04", "prerequisite_of", "平抛公式 → 水平位移由初速度和高度共同决定"),
        ("v2c5s4k02", "v2c5s4k05", "prerequisite_of", "平抛公式 → 速度方向与位移方向的关系"),
        ("v2c5s4k03", "v2c5s4k04", "prerequisite_of", "时间由高度决定 → 水平位移=初速度×该时间"),
        ("v2c5s4k05", "v2c5s4k06", "prerequisite_of", "平抛的矢量分析方法 → 斜抛运动定性理解"),
        ("v2c5s4k01", "v2c5s3k01", "applied_to", "平抛分解理论是平抛实验设计的依据"),
        ("v2c5s2k02", "v2c5s3k02", "applied_to", "矢量合成分解方法应用于平抛轨迹数据处理"),
    ]

    # ── 第六章 圆周运动 ── 内部前置链 ──
    v2_ch6 = [
        ("v2c6s1k01", "v2c6s1k02", "prerequisite_of", "圆周运动概念 → 线速度描述"),
        ("v2c6s1k01", "v2c6s1k03", "prerequisite_of", "圆周运动概念 → 角速度描述"),
        ("v2c6s1k02", "v2c6s1k05", "prerequisite_of", "线速度+角速度 → v=ωr关系"),
        ("v2c6s1k03", "v2c6s1k05", "prerequisite_of", "线速度+角速度 → v=ωr关系"),
        ("v2c6s1k05", "v2c6s1k06", "prerequisite_of", "v=ωr → 同轴转动和皮带传动的分析"),
        ("v2c6s1k02", "v2c6s3k01", "prerequisite_of", "线速度概念 → 向心加速度(速度方向变化率)"),
        ("v2c6s1k05", "v2c6s3k02", "prerequisite_of", "v=ωr → 向心加速度公式 a=v²/r=ω²r"),
        ("v2c6s2k01", "v2c6s2k02", "prerequisite_of", "向心力概念 → 向心力公式"),
        ("v2c6s2k01", "v2c6s2k03", "prerequisite_of", "向心力概念 → 向心力来源分析(效果力)"),
        ("v2c6s2k02", "v2c6s3k03", "prerequisite_of", "向心力公式 → F=ma联系向心力与向心加速度"),
        ("v2c6s2k03", "v2c6s2k04", "prerequisite_of", "向心力来源分析 → 圆周运动受力分析流程"),
        ("v2c6s2k04", "v2c6s2k05", "prerequisite_of", "圆周受力分析 → 水平面匀速圆周运动模型"),
        ("v2c6s2k04", "v2c6s4k01", "prerequisite_of", "圆周受力分析 → 汽车过拱桥模型"),
        ("v2c6s2k04", "v2c6s4k03", "prerequisite_of", "圆周受力分析 → 火车转弯与道路倾斜"),
        ("v2c6s2k04", "v2c6s4k02", "prerequisite_of", "圆周受力分析 → 竖直圆周最高点临界条件"),
        ("v2c6s4k02", "v2c6s4k05", "prerequisite_of", "竖直圆周临界 → 综合临界问题(绳/杆/轨道)"),
        ("v2c6s3k04", "v2c6s4k05", "prerequisite_of", "变速圆周加速度分解 → 综合临界分析"),
        ("v2c6s2k02", "v2c6s4k04", "prerequisite_of", "向心力公式 → 离心现象(所需向心力>实际合力)"),
    ]

    # ── 第七章 万有引力 ── 内部前置链 ──
    v2_ch7 = [
        ("v2c7s1k02", "v2c7s1k04", "prerequisite_of", "开普勒第一定律(椭圆轨道) → 第三定律(T²∝a³)"),
        ("v2c7s1k04", "v2c7s1k05", "prerequisite_of", "开普勒第三定律 → 高中圆轨道近似处理"),
        ("v2c7s1k04", "v2c7s2k01", "prerequisite_of", "开普勒定律 → 万有引力定律的发现(牛顿推导)"),
        ("v2c7s2k01", "v2c7s2k03", "prerequisite_of", "万有引力定律 → 地表重力≈万有引力"),
        ("v2c7s2k03", "v2c7s2k04", "prerequisite_of", "重力与万有引力关系 → 重力加速度随高度变化"),
        ("v2c7s2k01", "v2c7s2k05", "prerequisite_of", "万有引力定律 → 天体运动中万有引力提供向心力"),
        ("v2c7s2k05", "v2c7s3k01", "prerequisite_of", "万有引力=向心力 → 计算中心天体质量"),
        ("v2c7s2k05", "v2c7s3k03", "prerequisite_of", "万有引力=向心力 → 推导卫星v、ω、T与轨道半径关系"),
        ("v2c7s3k01", "v2c7s3k02", "prerequisite_of", "天体质量计算 → 结合体积求天体密度"),
        ("v2c7s3k03", "v2c7s4k01", "prerequisite_of", "卫星运动规律 → 第一宇宙速度推导"),
        ("v2c7s3k03", "v2c7s4k03", "prerequisite_of", "卫星运动规律 → 人造卫星轨道参数分析"),
        ("v2c7s3k03", "v2c7s4k04", "prerequisite_of", "卫星运动规律 → 同步卫星(特定轨道)"),
        ("v2c7s3k04", "v2c7s4k01", "prerequisite_of", "近地卫星概念 → 第一宇宙速度"),
        ("v2c7s4k03", "v2c7s4k05", "prerequisite_of", "卫星轨道参数 → 卫星变轨定性分析"),
        ("v2c7s3k03", "v2c7s3k05", "prerequisite_of", "卫星运动规律 → 双星模型(共同质心)"),
        ("v2c7s2k01", "v2c7s2k02", "prerequisite_of", "万有引力定律 → 引力常量G的测定(卡文迪什)"),
    ]

    # ── 第八章 机械能 ── 内部前置链 ──
    v2_ch8 = [
        ("v2c8s1k01", "v2c8s1k02", "prerequisite_of", "功的概念 → 正功、负功判断"),
        ("v2c8s1k01", "v2c8s1k03", "prerequisite_of", "功的概念 → 恒力做功计算"),
        ("v2c8s1k02", "v2c8s1k04", "prerequisite_of", "正负功 → 总功(各力做功代数和)"),
        ("v2c8s1k01", "v2c8s1k05", "prerequisite_of", "功的概念 → 功率(做功快慢)"),
        ("v2c8s1k05", "v2c8s1k06", "prerequisite_of", "功率 → 机车启动模型(恒功率/恒牵引力)"),
        ("v2c8s1k04", "v2c8s3k02", "prerequisite_of", "总功概念 → 动能定理(W合=ΔEk)"),
        ("v2c8s2k01", "v2c8s2k02", "prerequisite_of", "重力做功特点(与路径无关) → 重力势能概念"),
        ("v2c8s2k01", "v2c8s2k03", "prerequisite_of", "重力做功特点 → WG=-ΔEp"),
        ("v2c8s3k01", "v2c8s3k02", "prerequisite_of", "动能概念 → 动能定理"),
        ("v2c8s3k02", "v2c8s3k03", "prerequisite_of", "动能定理 → 单过程应用"),
        ("v2c8s3k02", "v2c8s3k04", "prerequisite_of", "动能定理 → 多过程分段应用"),
        ("v2c8s3k02", "v2c8s3k05", "prerequisite_of", "动能定理 → 摩擦力做功与能量损失"),
        ("v2c8s2k02", "v2c8s4k01", "prerequisite_of", "重力势能+动能 → 机械能概念"),
        ("v2c8s4k01", "v2c8s4k02", "prerequisite_of", "机械能概念 → 机械能守恒条件"),
        ("v2c8s4k02", "v2c8s4k03", "prerequisite_of", "机械能守恒条件 → 守恒定律表达式"),
        ("v2c8s4k03", "v2c8s4k04", "prerequisite_of", "机械能守恒表达式 → 单体模型应用"),
        ("v2c8s4k03", "v2c8s4k05", "prerequisite_of", "机械能守恒表达式 → 系统模型(连接体/弹簧)"),
        ("v2c8s4k02", "v2c8s4k06", "prerequisite_of", "机械能守恒条件 → 不满足条件时的能量变化分析"),
        ("v2c8s4k03", "v2c8s4k07", "prerequisite_of", "机械能守恒 → 与动力学方法的比较与选择"),
        ("v2c8s4k01", "v2c8s5k01", "prerequisite_of", "机械能概念 → 验证机械能守恒实验原理"),
        ("v2c8s5k01", "v2c8s5k02", "prerequisite_of", "实验原理 → 纸带速度计算"),
        ("v2c8s5k01", "v2c8s5k03", "prerequisite_of", "实验原理 → 数据处理(mgh vs ½mv²)"),
        ("v2c8s5k03", "v2c8s5k04", "prerequisite_of", "数据处理 → 实验误差分析"),
        ("v2c8s5k02", "v2c8s5k05", "prerequisite_of", "纸带速度计算 → v²-h图像法验证"),
    ]

    # ── v2 跨章节前置 ──
    v2_cross = [
        ("v2c6s2k02", "v2c7s2k05", "prerequisite_of", "向心力公式 → 万有引力提供向心力(天体运动)"),
        ("v2c6s1k02", "v2c7s3k03", "prerequisite_of", "线速度概念 → 卫星线速度、角速度、周期关系"),
        ("v2c6s1k04", "v2c7s4k04", "prerequisite_of", "周期概念 → 同步卫星周期=地球自转周期"),
        ("v2c5s4k02", "v2c8s3k03", "applied_to", "平抛运动公式 → 可用动能定理分析平抛速度变化"),
        ("v2c6s2k05", "v2c8s4k04", "applied_to", "水平圆周运动 → 可用机械能守恒分析圆锥摆"),
    ]

    # ── v2 易混点 ──
    v2_confused = [
        ("v2c5s1k01", "v2c5s1k02", "confused_with", "曲线运动速度方向(切线)与合力方向(指向凹侧)学生常混淆"),
        ("v2c5s4k03", "v2c5s4k04", "confused_with", "平抛时间(仅由高度决定) vs 水平位移(由初速度和时间共同决定)——学生常认为初速度越大落地越晚"),
        ("v2c6s1k02", "v2c6s1k03", "confused_with", "线速度(沿切线) vs 角速度(转过角度)——两个不同维度描述圆周运动快慢"),
        ("v2c6s2k01", "v2c6s2k03", "confused_with", "向心力是效果力(由其他力提供)非性质力——学生常在受力分析中额外添加'向心力'"),
        ("v2c6s1k06", "v2c6s4k05", "confused_with", "同轴传动(ω相等) vs 皮带传动(v相等)——学生常混淆两种传动中哪个量相等"),
        ("v2c7s2k03", "v2c7s2k04", "confused_with", "重力vs万有引力——地表附近两者近似相等但本质不同"),
        ("v2c7s3k03", "v2c7s4k03", "confused_with", "卫星轨道半径越大→v越小(学生直觉相反，认为越大越快)"),
        ("v2c7s4k04", "v2c7s4k03", "confused_with", "同步卫星特殊条件(赤道平面上方、固定高度)vs一般卫星"),
        ("v2c8s1k01", "v2c8s3k01", "confused_with", "功(过程量)vs动能(状态量)——功是能量转化的量度"),
        ("v2c8s1k02", "v2c8s1k03", "confused_with", "功的正负看F与位移夹角——学生常只看力方向不看位移方向"),
        ("v2c8s2k02", "v2c8s2k03", "confused_with", "重力势能(状态量)vs重力做功(过程量)——WG=-ΔEp"),
        ("v2c8s3k02", "v2c8s4k02", "confused_with", "动能定理(任何过程都可用)vs机械能守恒(仅保守力)——有摩擦时仍套用机械能守恒是典型错误"),
        ("v2c8s4k05", "v2c8s4k06", "confused_with", "机械能守恒(系统)vs机械能不守恒(有非保守力)——系统内力是否保守的判断"),
        ("v2c8s1k06", "v2c8s4k07", "confused_with", "机车启动用动力学方法(牛二)vs能量方法(动能定理)——各有适用场景"),
    ]

    # ── v2 跨册前置（从必修一） ──
    v2_from_v1 = [
        # v1c1 运动学 → v2
        ("v1c1s2k01", "v2c5s2k01", "prerequisite_of", "时间概念 → 合运动与分运动具有等时性"),
        ("v1c1s3k01", "v2c5s1k01", "prerequisite_of", "速度概念(直线) → 曲线运动中速度方向沿切线"),
        ("v1c1s3k02", "v2c5s1k03", "prerequisite_of", "加速度概念 → 速度方向变化意味着加速度存在，曲线运动必为变速运动"),
        ("v1c1s3k03", "v2c5s4k01", "prerequisite_of", "匀变速直线运动 → 平抛运动竖直方向为自由落体"),
        ("v1c1s3k03", "v2c5s4k02", "prerequisite_of", "匀变速运动公式 → 平抛运动基本公式的推导基础"),
        # v1c2 匀变速
        ("v1c2s3k01", "v2c5s4k01", "prerequisite_of", "自由落体运动 → 平抛运动竖直分运动即自由落体"),
        ("v1c2s4k01", "v2c5s4k02", "prerequisite_of", "匀变速直线运动公式 → 平抛水平匀速+竖直自由落体"),
        # v1c3 力
        ("v1c3s1k01", "v2c6s2k01", "prerequisite_of", "力的概念 → 向心力概念建立"),
        ("v1c3s4k01", "v2c5s2k02", "prerequisite_of", "力的合成与分解 → 运动矢量(位移/速度/加速度)的合成与分解"),
        ("v1c3s4k01", "v2c6s2k04", "prerequisite_of", "受力分析方法 → 圆周运动中的受力分析和向心力来源判断"),
        ("v1c3s5k01", "v2c6s2k04", "prerequisite_of", "共点力平衡 → 圆周运动中沿半径方向列合力方程"),
        ("v1c3s5k01", "v2c8s1k06", "prerequisite_of", "平衡条件+牛二 → 机车启动模型的动态分析"),
        ("v1c4s3k01", "v2c8s3k02", "prerequisite_of", "牛顿第二定律(F=ma) → 动能定理的动力学基础"),
        # v1c4 牛二应用
        ("v1c4s3k01", "v2c6s2k02", "prerequisite_of", "牛顿第二定律 → F=ma应用于圆周运动得向心力公式"),
        ("v1c4s3k01", "v2c7s2k05", "prerequisite_of", "牛顿第二定律 → 万有引力=向心力=ma，天体运动的动力学方程"),
        ("v1c4s3k01", "v2c8s1k06", "prerequisite_of", "牛顿第二定律 → 机车启动中牵引力和加速度的动态变化"),
        ("v1c4s5k01", "v2c6s4k01", "prerequisite_of", "超重与失重 → 汽车过拱桥最高点的失重分析"),
    ]

    v2_all = v2_ch5 + v2_ch6 + v2_ch7 + v2_ch8 + v2_cross + v2_confused + v2_from_v1

    # =========================================================================
    # 必修第三册 (v3) — 静电场 / 电路 / 电能 / 电磁感应初步
    # =========================================================================

    # ── 第九章 静电场及其应用 ──
    v3_ch9 = [
        ("v3c9s1k01", "v3c9s1k03", "prerequisite_of", "电荷与带电现象 → 静电感应(自由电荷重新分布)"),
        ("v3c9s1k01", "v3c9s1k04", "prerequisite_of", "电荷概念 → 电荷守恒定律"),
        ("v3c9s1k03", "v3c9s1k02", "prerequisite_of", "静电感应 → 感应起电是三种起电方式之一"),
        ("v3c9s1k02", "v3c9s1k06", "prerequisite_of", "起电方式 → 验电器张角判断电荷"),
        ("v3c9s1k04", "v3c9s2k01", "prerequisite_of", "电荷守恒 → 点电荷模型(理想化条件)"),
        ("v3c9s2k01", "v3c9s2k02", "prerequisite_of", "点电荷模型 → 库仑定律 F=kq₁q₂/r²"),
        ("v3c9s2k02", "v3c9s2k03", "prerequisite_of", "库仑定律 → 库仑力方向判断(同斥异吸)"),
        ("v3c9s2k02", "v3c9s2k04", "prerequisite_of", "库仑定律 → 多电荷库仑力矢量合成"),
        ("v3c9s2k04", "v3c9s2k05", "prerequisite_of", "库仑力矢量合成 → 带电小球平衡问题(悬线偏角等)"),
        ("v3c9s2k02", "v3c9s3k01", "prerequisite_of", "库仑定律(超距作用问题) → 电场概念的提出(近距作用)"),
        ("v3c9s3k01", "v3c9s3k03", "prerequisite_of", "电场概念 → 电场强度定义 E=F/q(比值定义法)"),
        ("v3c9s3k01", "v3c9s3k02", "prerequisite_of", "电场概念 → 试探电荷(微小电荷，不改变原电场)"),
        ("v3c9s3k03", "v3c9s3k04", "prerequisite_of", "电场强度定义 → 点电荷电场强度 E=kQ/r²"),
        ("v3c9s3k04", "v3c9s3k05", "prerequisite_of", "点电荷电场 → 多场源电场强度叠加(矢量)"),
        ("v3c9s3k03", "v3c9s3k06", "prerequisite_of", "电场强度 → 电场线(疏密表强弱、切线表方向)"),
        ("v3c9s3k06", "v3c9s3k07", "prerequisite_of", "电场线 → 匀强电场(电场线平行等间距)"),
        ("v3c9s3k03", "v3c9s3k08", "prerequisite_of", "电场强度 → 电场力计算 F=qE"),
        ("v3c9s3k08", "v3c9s4k01", "prerequisite_of", "电场力 → 静电平衡(导体内部E=0)"),
        ("v3c9s4k01", "v3c9s4k06", "prerequisite_of", "静电平衡 → 静电平衡导体三特性(内部E=0/净电荷在外表面/等势体)"),
        ("v3c9s4k01", "v3c9s4k02", "prerequisite_of", "静电平衡 → 尖端放电(尖端处E强)"),
        ("v3c9s4k01", "v3c9s4k03", "prerequisite_of", "静电平衡 → 静电屏蔽(导体壳屏蔽外电场)"),
    ]

    # ── 第十章 静电场中的能量 ──
    v3_ch10 = [
        ("v3c9s3k08", "v3c10s1k01", "prerequisite_of", "电场力 → 电场力做功特点(与路径无关)"),
        ("v3c10s1k01", "v3c10s1k02", "prerequisite_of", "电场力做功 → 电势能(类比重力做功→重力势能)"),
        ("v3c10s1k02", "v3c10s1k03", "prerequisite_of", "电势能 → 电势 φ=Ep/q(比值定义法)"),
        ("v3c10s1k03", "v3c10s1k04", "prerequisite_of", "电势概念 → 电势高低判断(沿电场线方向电势降低)"),
        ("v3c10s1k02", "v3c10s1k05", "prerequisite_of", "电势能 → 电势能变化判断(电场力做正功→Ep减小)"),
        ("v3c10s1k03", "v3c10s2k01", "prerequisite_of", "电势 → 电势差 U=φa-φb"),
        ("v3c10s2k01", "v3c10s2k02", "prerequisite_of", "电势差 → 电场力做功与电势差 W=qU"),
        ("v3c10s2k01", "v3c10s2k03", "prerequisite_of", "电势差 → 电势差正负含义"),
        ("v3c10s1k03", "v3c10s2k04", "prerequisite_of", "电势 → 等势面(电势相等的点构成的面)"),
        ("v3c9s3k06", "v3c10s2k05", "prerequisite_of", "电场线 → 电场线与等势面垂直，指向电势降低方向"),
        ("v3c9s3k07", "v3c10s3k01", "prerequisite_of", "匀强电场 → U=Ed(电势差与场强的关系)"),
        ("v3c10s3k01", "v3c10s3k02", "prerequisite_of", "U=Ed → 电场强度反映电势变化快慢"),
        ("v3c10s3k01", "v3c10s3k03", "prerequisite_of", "U=Ed → d为沿电场方向的距离投影"),
        ("v3c10s1k02", "v3c10s4k01", "prerequisite_of", "电势能概念 → 电容器储存电场能"),
        ("v3c10s4k01", "v3c10s4k02", "prerequisite_of", "电容器概念 → 电容定义 C=Q/U"),
        ("v3c10s4k02", "v3c10s4k03", "prerequisite_of", "电容定义 → 平行板电容器 C=εS/(4πkd)"),
        ("v3c10s4k03", "v3c10s4k04", "prerequisite_of", "平行板电容器 → 电容器动态分析(d/S/ε变化→C/Q/U/E变化)"),
        ("v3c9s3k08", "v3c10s5k01", "prerequisite_of", "电场力 → 带电粒子在电场中的加速"),
        ("v3c10s5k01", "v3c10s5k02", "prerequisite_of", "电场加速 → 带电粒子在匀强电场中直线运动"),
        ("v3c10s5k01", "v3c10s5k03", "prerequisite_of", "电场加速 → 带电粒子在匀强电场中偏转(类平抛)"),
        ("v3c10s5k03", "v3c10s5k04", "prerequisite_of", "电场偏转 → 示波管偏转模型"),
        ("v3c10s5k03", "v3c10s5k05", "prerequisite_of", "电场偏转 → 电场运动中的能量+运动学联立"),
    ]

    # ── 第十一章 电路及其应用 ──
    v3_ch11 = [
        ("v3c11s1k01", "v3c11s1k03", "prerequisite_of", "电源概念 → 电流 I=q/t"),
        ("v3c11s1k01", "v3c11s1k02", "prerequisite_of", "电源 → 恒定电场(导线内电场驱动电荷)"),
        ("v3c11s1k03", "v3c11s1k04", "prerequisite_of", "电流 → 电流方向(正电荷定向移动方向)"),
        ("v3c11s1k03", "v3c11s2k01", "prerequisite_of", "电流 → 电阻概念(对电流的阻碍)"),
        ("v3c11s2k01", "v3c11s2k02", "prerequisite_of", "电阻概念 → 欧姆定律 I=U/R"),
        ("v3c11s2k02", "v3c11s2k03", "prerequisite_of", "欧姆定律 → 伏安特性曲线(U-I图/I-U图)"),
        ("v3c11s2k01", "v3c11s2k04", "prerequisite_of", "电阻 → 电阻定律 R=ρL/S"),
        ("v3c11s2k04", "v3c11s2k05", "prerequisite_of", "电阻定律 → 电阻率(材料特性，随温度变化)"),
        ("v3c11s2k02", "v3c11s3k01", "prerequisite_of", "欧姆定律 → 伏安法测电阻 R=U/I"),
        ("v3c11s3k01", "v3c11s3k02", "prerequisite_of", "伏安法测电阻 → 电流表内接与外接(误差分析)"),
        ("v3c11s3k01", "v3c11s3k03", "prerequisite_of", "伏安法测电阻 → 滑动变阻器限流与分压接法"),
        ("v3c11s2k04", "v3c11s3k06", "prerequisite_of", "电阻定律 → 电阻率实验数据处理"),
        ("v3c11s2k02", "v3c11s4k01", "prerequisite_of", "欧姆定律 → 串联电路规律(电流相等/电压分配)"),
        ("v3c11s2k02", "v3c11s4k02", "prerequisite_of", "欧姆定律 → 并联电路规律(电压相等/电流分配)"),
        ("v3c11s4k01", "v3c11s4k03", "prerequisite_of", "串并联规律 → 电压分配和电流分配计算"),
        ("v3c11s4k01", "v3c11s4k04", "prerequisite_of", "串联+并联 → 混联电路等效化简"),
        ("v3c11s4k02", "v3c11s4k05", "prerequisite_of", "并联规律 → 电表改装原理(分流/分压)"),
        ("v3c11s4k05", "v3c11s4k06", "prerequisite_of", "电表改装原理 → 电压表和电流表的电路结构"),
        ("v3c11s4k01", "v3c11s5k01", "prerequisite_of", "串并联规律 → 多用电表的基本功能"),
        ("v3c11s5k01", "v3c11s5k02", "prerequisite_of", "多用电表功能 → 测量电压和电流"),
        ("v3c11s4k05", "v3c11s5k03", "prerequisite_of", "电表改装 → 欧姆表测电阻(闭合电路欧姆定律应用)"),
        ("v3c11s5k03", "v3c11s5k04", "prerequisite_of", "欧姆表测电阻 → 欧姆表读数(不均匀刻度)"),
    ]

    # ── 第十二章 电能 能量守恒定律 ──
    v3_ch12 = [
        ("v3c11s1k03", "v3c12s1k01", "prerequisite_of", "电流概念 → 电功 W=UIt"),
        ("v3c12s1k01", "v3c12s1k02", "prerequisite_of", "电功 → 电功率 P=UI"),
        ("v3c11s2k02", "v3c12s1k03", "prerequisite_of", "欧姆定律 → 焦耳定律 Q=I²Rt"),
        ("v3c12s1k03", "v3c12s1k04", "prerequisite_of", "焦耳定律 → 纯电阻电路(W=Q)"),
        ("v3c12s1k03", "v3c12s1k05", "prerequisite_of", "焦耳定律 → 非纯电阻电路(W>Q，如电动机)"),
        ("v3c12s1k01", "v3c12s1k06", "prerequisite_of", "电功/电热 → 电路中的能量守恒"),
        ("v3c11s1k01", "v3c12s2k01", "prerequisite_of", "电源概念 → 电动势E(非静电力做功)"),
        ("v3c12s2k01", "v3c12s2k02", "prerequisite_of", "电动势 → 内阻(电源内部电阻)"),
        ("v3c11s2k02", "v3c12s2k03", "prerequisite_of", "欧姆定律 → 闭合电路欧姆定律 I=E/(R+r)"),
        ("v3c12s2k03", "v3c12s2k04", "prerequisite_of", "闭合电路欧姆定律 → 路端电压 U=E-Ir，随外电阻变化"),
        ("v3c12s2k03", "v3c12s2k05", "prerequisite_of", "闭合电路欧姆定律 → 电源输出功率 P出=I²R"),
        ("v3c12s2k03", "v3c12s2k06", "prerequisite_of", "闭合电路欧姆定律 → 电源效率 η=P出/P总"),
        ("v3c12s2k04", "v3c12s2k07", "prerequisite_of", "路端电压与外电阻关系 → 闭合电路动态分析(R变→I变→U变)"),
        ("v3c12s2k03", "v3c12s3k01", "prerequisite_of", "闭合电路欧姆定律 → 伏安法测E和r"),
        ("v3c12s3k01", "v3c12s3k02", "prerequisite_of", "伏安法测E,r → U-I图像法(截距E/斜率-r)"),
        ("v3c12s3k01", "v3c12s3k03", "prerequisite_of", "实验原理 → 实验电路设计(内接/外接)"),
        ("v3c12s3k02", "v3c12s3k04", "prerequisite_of", "U-I图像法 → 实验误差分析(系统误差/偶然误差)"),
        ("v3c12s2k03", "v3c12s4k01", "prerequisite_of", "闭合电路能量关系 → 能量守恒定律在电路中的体现"),
        ("v3c12s4k01", "v3c12s4k02", "prerequisite_of", "能量守恒 → 能量转化具有方向性(引出热力学第二定律)"),
    ]

    # ── 第十三章 电磁感应与电磁波初步 ──
    v3_ch13 = [
        ("v3c13s1k01", "v3c13s1k02", "prerequisite_of", "磁场概念 → 磁感线(描述磁场分布)"),
        ("v3c13s1k02", "v3c13s1k03", "prerequisite_of", "磁感线 → 条形磁体磁场分布"),
        ("v3c13s1k03", "v3c13s1k04", "prerequisite_of", "磁体磁场 → 电流的磁效应(奥斯特实验)"),
        ("v3c13s1k04", "v3c13s1k05", "prerequisite_of", "电流的磁效应 → 安培定则(判断电流磁场方向)"),
        ("v3c13s1k02", "v3c13s2k01", "prerequisite_of", "磁感线 → 磁感应强度B(描述磁场强弱)"),
        ("v3c13s2k01", "v3c13s2k02", "prerequisite_of", "磁感应强度 → 安培力 F=BILsinθ(磁场对电流的作用)"),
        ("v3c13s2k01", "v3c13s2k03", "prerequisite_of", "磁感应强度 → 磁通量 Φ=BScosθ"),
        ("v3c13s2k03", "v3c13s2k04", "prerequisite_of", "磁通量 → 磁通量变化(ΔΦ=B变/S变/θ变)"),
        ("v3c13s2k04", "v3c13s3k01", "prerequisite_of", "磁通量变化 → 电磁感应现象(Φ变→产生感应电动势)"),
        ("v3c13s3k01", "v3c13s3k02", "prerequisite_of", "电磁感应现象 → 感应电流产生条件(回路闭合+Φ变化)"),
        ("v3c13s3k02", "v3c13s3k03", "prerequisite_of", "感应电流条件 → 感应电动势(不闭合也有电动势)"),
        ("v3c13s3k03", "v3c13s3k04", "prerequisite_of", "感应电动势 → 发电机原理(机械能→电能)"),
        ("v3c13s3k01", "v3c13s4k01", "prerequisite_of", "电磁感应 → 麦克斯韦电磁场理论(变化的电场→磁场)"),
        ("v3c13s4k01", "v3c13s4k02", "prerequisite_of", "麦克斯韦理论 → 电磁波(电场和磁场交替传播)"),
        ("v3c13s4k02", "v3c13s4k04", "prerequisite_of", "电磁波 → 电磁波谱(无线电波→γ射线)"),
        ("v3c13s3k03", "v3c13s5k01", "prerequisite_of", "电磁学发展 → 黑体辐射问题(经典物理困难)"),
        ("v3c13s5k01", "v3c13s5k02", "prerequisite_of", "黑体辐射问题 → 能量量子化(普朗克假设)"),
        ("v3c13s5k02", "v3c13s5k03", "prerequisite_of", "能量量子化 → 能量子 ε=hν"),
        ("v3c13s5k03", "v3c13s5k04", "prerequisite_of", "能量子 → 光子概念初步"),
    ]

    # ── v3 跨章节前置 ──
    v3_cross = [
        ("v3c9s3k03", "v3c10s1k03", "prerequisite_of", "电场强度(力的性质) → 电势(能的性质)——静电场的两个侧面"),
        ("v3c9s3k08", "v3c10s5k02", "prerequisite_of", "电场力 F=qE → 带电粒子在匀强电场中的直线运动"),
        ("v3c11s2k02", "v3c12s2k03", "prerequisite_of", "部分电路欧姆定律 → 闭合电路欧姆定律(含内阻)"),
        ("v3c10s1k02", "v3c12s4k01", "prerequisite_of", "电势能概念 → 更广义的能量守恒定律"),
        ("v3c13s1k04", "v3c13s3k01", "prerequisite_of", "电流产生磁场 → 磁生电(电磁感应)——电与磁的对称性"),
        ("v3c13s2k03", "v3c13s3k02", "prerequisite_of", "磁通量概念 → 感应电流产生条件(Φ变化)"),
        ("v3c13s5k02", "v3c13s4k02", "prerequisite_of", "能量量子化 → 电磁波量子性理解"),
    ]

    # ── v3 易混点 ──
    v3_confused = [
        ("v3c9s3k03", "v3c9s3k08", "confused_with", "电场强度E(场的属性)vs电场力F(电荷受力)——E=F/q是比值定义，E与q无关"),
        ("v3c10s1k02", "v3c10s1k03", "confused_with", "电势能(属于电荷)vs电势(属于电场)——φ=Ep/q，类比重力势能vs高度"),
        ("v3c9s3k06", "v3c10s2k05", "confused_with", "电场线(力的性质)vs等势面(能的性质)——两者垂直，不能混淆"),
        ("v3c12s2k01", "v3c12s2k04", "confused_with", "电动势(表征电源)vs路端电压(外电路电压)——有内阻时U<E"),
        ("v3c12s1k01", "v3c12s1k03", "confused_with", "电功W=UIt vs 电热Q=I²Rt——纯电阻相等，非纯电阻W>Q"),
        ("v3c13s1k02", "v3c9s3k06", "confused_with", "磁感线(闭合曲线)vs电场线(从正电荷到负电荷)——磁场无'磁荷'"),
        ("v3c13s1k05", "v3c13s3k04", "confused_with", "安培定则(电流→磁场)vs右手定则(磁→电)——前者用于电生磁，后者用于磁生电"),
        ("v3c11s3k02", "v3c11s3k03", "confused_with", "电流表内接(测大电阻)vs外接(测小电阻)——相对误差来源不同"),
        ("v3c11s4k03", "v3c12s2k04", "confused_with", "串联分压vs并联分流——两个相反的分配规律"),
        ("v3c13s2k03", "v3c13s3k03", "confused_with", "磁通量Φ(状态量)vs感应电动势(过程量)——E由ΔΦ/Δt决定，非Φ本身"),
        ("v3c10s5k03", "v3c10s5k05", "confused_with", "电场偏转(类平抛)vs平抛运动——前者F=qE恒定，后者mg恒定；前者可加电场改变轨迹"),
        ("v3c9s4k01", "v3c9s4k03", "confused_with", "静电平衡(导体内部E=0)vs静电屏蔽(壳内不受外电场影响)"),
        ("v3c12s4k02", "v3c12s4k04", "confused_with", "能量转化方向性vs能源利用效率——前者是物理规律，后者是工程指标"),
    ]

    # ── v3 跨册前置（从必修一二） ──
    v3_from_other = [
        ("v1c3s4k01", "v3c9s2k04", "prerequisite_of", "力的合成与分解(矢量方法) → 库仑力矢量合成"),
        ("v1c3s5k01", "v3c9s2k05", "prerequisite_of", "共点力平衡 → 带电小球平衡问题"),
        ("v1c4s3k01", "v3c10s5k02", "prerequisite_of", "牛顿第二定律 → 带电粒子在电场中的加速和偏转"),
        ("v2c5s4k01", "v3c10s5k03", "prerequisite_of", "平抛运动分解 → 带电粒子在匀强电场中的类平抛偏转"),
        ("v2c8s1k01", "v3c10s1k01", "prerequisite_of", "功的概念 → 电场力做功(类比引力做功)"),
        ("v2c8s2k02", "v3c10s1k02", "prerequisite_of", "重力势能 → 电势能(类比Ep=mgh和Ep=qφ)"),
        ("v2c8s3k02", "v3c10s5k05", "prerequisite_of", "动能定理 → 电场运动中的能量与运动学联立"),
        ("v2c8s4k01", "v3c12s1k06", "prerequisite_of", "机械能守恒 → 电路中的能量守恒(能量观点的延续)"),
        ("v2c6s2k04", "v3c10s5k03", "prerequisite_of", "受力分析方法 → 带电粒子在电场中的受力与运动分析"),
    ]

    v3_all = v3_ch9 + v3_ch10 + v3_ch11 + v3_ch12 + v3_ch13 + v3_cross + v3_confused + v3_from_other

    # =========================================================================
    # 选择性必修第一册 (x1) — 动量守恒 / 机械振动 / 机械波 / 光
    # =========================================================================

    # ── 第一章 动量守恒定律 ──
    x1_ch1 = [
        ("x1c1s1k01", "x1c1s1k02", "prerequisite_of", "动量 p=mv → 动量变化量 Δp(矢量差)"),
        ("x1c1s1k01", "x1c1s1k03", "prerequisite_of", "动量概念 → 动量与动能的比较(矢量vs标量)"),
        ("x1c1s1k02", "x1c1s1k04", "prerequisite_of", "动量变化量 → 一维正负号规定"),
        ("x1c1s1k01", "x1c1s2k01", "prerequisite_of", "动量概念 → 冲量 I=Ft(力对时间的积累)"),
        ("x1c1s2k01", "x1c1s2k02", "prerequisite_of", "冲量概念 → 动量定理 I合=Δp"),
        ("x1c1s2k02", "x1c1s2k03", "prerequisite_of", "动量定理 → 变力冲量(F-t图像面积)"),
        ("x1c1s2k02", "x1c1s2k04", "prerequisite_of", "动量定理 → 缓冲问题(延长作用时间减小平均力)"),
        ("x1c1s2k02", "x1c1s2k05", "prerequisite_of", "动量定理 → 与牛顿第二定律的关系(F=ma是瞬时式，Ft=Δp是过程式)"),
        ("x1c1s1k04", "x1c1s3k01", "prerequisite_of", "动量正负号 → 系统动量守恒条件(合外力为零)"),
        ("x1c1s3k01", "x1c1s3k02", "prerequisite_of", "动量守恒条件 → 内力与外力区分(判断守恒的关键)"),
        ("x1c1s3k01", "x1c1s3k03", "prerequisite_of", "动量守恒条件 → 一维动量守恒方程 m1v1+m2v2=m1v1'+m2v2'"),
        ("x1c1s3k03", "x1c1s3k04", "prerequisite_of", "动量守恒方程 → 人船模型(位移关系)"),
        ("x1c1s3k03", "x1c1s3k05", "prerequisite_of", "动量守恒方程 → 爆炸分离模型(内能→动能)"),
        ("x1c1s3k01", "x1c1s3k06", "prerequisite_of", "动量守恒条件 → 某方向动量守恒(合外力不为零但某方向为零)"),
        ("x1c1s3k01", "x1c1s5k01", "prerequisite_of", "动量守恒 → 弹性碰撞(动量+动能同时守恒)"),
        ("x1c1s5k01", "x1c1s5k02", "prerequisite_of", "弹性碰撞 → 非弹性碰撞(动量守恒但动能不守恒)"),
        ("x1c1s5k02", "x1c1s5k03", "prerequisite_of", "非弹性碰撞 → 完全非弹性碰撞(碰后共速，动能损失最大)"),
        ("x1c1s5k01", "x1c1s5k04", "prerequisite_of", "弹性碰撞 → 一维弹性碰撞结论(等质量交换速度等)"),
        ("x1c1s5k01", "x1c1s5k05", "prerequisite_of", "弹性/非弹性碰撞 → 碰撞综合判别三判据(动量守恒+动能不增+速度合理)"),
        ("x1c1s3k01", "x1c1s6k01", "prerequisite_of", "动量守恒 → 反冲现象(系统动量守恒→反向运动)"),
        ("x1c1s6k01", "x1c1s6k02", "prerequisite_of", "反冲现象 → 火箭运动原理(喷气反冲)"),
        ("x1c1s3k03", "x1c1s6k03", "prerequisite_of", "动量守恒方程 → 反冲速度计算"),
        ("x1c1s3k01", "x1c1s4k01", "prerequisite_of", "动量守恒 → 气垫导轨验证实验"),
        ("x1c1s4k01", "x1c1s4k02", "prerequisite_of", "气垫导轨实验 → 斜槽小球实验(落点法)"),
        ("x1c1s4k01", "x1c1s4k03", "prerequisite_of", "实验原理 → 实验条件控制(水平方向合外力为零)"),
        ("x1c1s4k02", "x1c1s4k04", "prerequisite_of", "实验操作 → 误差分析(摩擦/读数/落点分散/碰撞不正)"),
    ]

    # ── 第二章 机械振动 ──
    x1_ch2 = [
        ("x1c2s1k01", "x1c2s1k02", "prerequisite_of", "机械振动概念 → 简谐运动(x=Asin(ωt+φ))"),
        ("x1c2s1k02", "x1c2s1k03", "prerequisite_of", "简谐运动 → 平衡位置与位移(相对平衡位置的有向距离)"),
        ("x1c2s1k02", "x1c2s1k04", "prerequisite_of", "简谐运动 → x-t图像分析"),
        ("x1c2s1k04", "x1c2s2k01", "prerequisite_of", "x-t图像 → 振幅(最大位移)"),
        ("x1c2s1k04", "x1c2s2k02", "prerequisite_of", "x-t图像 → 周期和频率(T=1/f)"),
        ("x1c2s2k02", "x1c2s2k05", "prerequisite_of", "周期和频率 → 角频率 ω=2π/T=2πf"),
        ("x1c2s2k01", "x1c2s2k04", "prerequisite_of", "振幅+周期 → 简谐运动表达式 x=Asin(ωt+φ)"),
        ("x1c2s1k02", "x1c2s3k01", "prerequisite_of", "简谐运动 → 回复力 F=-kx"),
        ("x1c2s3k01", "x1c2s3k02", "prerequisite_of", "回复力 → 简谐运动动力学条件(F回=-kx)"),
        ("x1c2s3k01", "x1c2s3k03", "prerequisite_of", "回复力 → 弹簧振子模型(T=2π√(m/k))"),
        ("x1c2s3k02", "x1c2s3k04", "prerequisite_of", "动力学条件 → 振动能量转化(Ek↔Ep，总能量不变)"),
        ("x1c2s1k04", "x1c2s3k05", "prerequisite_of", "x-t图像 → 位移/速度/加速度关系(平衡位置v最大a=0，最大位移v=0a最大)"),
        ("x1c2s3k01", "x1c2s4k01", "prerequisite_of", "回复力 → 单摆模型(摆角<5°)"),
        ("x1c2s4k01", "x1c2s4k02", "prerequisite_of", "单摆模型 → 单摆回复力(重力切向分力，F=-mgx/L)"),
        ("x1c2s4k02", "x1c2s4k03", "prerequisite_of", "单摆回复力 → 单摆周期公式 T=2π√(L/g)"),
        ("x1c2s4k03", "x1c2s4k04", "prerequisite_of", "周期公式 → 等效重力加速度(非惯性系/电场中的等效)"),
        ("x1c2s4k03", "x1c2s5k01", "prerequisite_of", "周期公式 → 用单摆测重力加速度 g=4π²L/T²"),
        ("x1c2s5k01", "x1c2s5k02", "prerequisite_of", "测g原理 → 摆长测量(悬点到球心)"),
        ("x1c2s5k01", "x1c2s5k03", "prerequisite_of", "测g原理 → 周期测量(累积法减小误差)"),
        ("x1c2s2k02", "x1c2s6k01", "prerequisite_of", "周期/频率 → 固有振动和固有频率"),
        ("x1c2s6k01", "x1c2s6k02", "prerequisite_of", "固有振动 → 受迫振动(驱动频率下的振动)"),
        ("x1c2s6k02", "x1c2s6k03", "prerequisite_of", "受迫振动 → 共振(驱动频率=固有频率)"),
    ]

    # ── 第三章 机械波 ──
    x1_ch3 = [
        ("x1c2s1k02", "x1c3s1k01", "prerequisite_of", "简谐运动 → 机械波形成条件(波源+介质)"),
        ("x1c3s1k01", "x1c3s1k02", "prerequisite_of", "波的形成 → 横波和纵波(振动方向vs传播方向)"),
        ("x1c3s1k01", "x1c3s1k03", "prerequisite_of", "波的形成 → 波传播的是振动形式和能量(质点不随波迁移)"),
        ("x1c3s1k02", "x1c3s2k01", "prerequisite_of", "横波/纵波 → 波长λ(相邻同相点距离)"),
        ("x1c2s2k02", "x1c3s2k02", "prerequisite_of", "周期/频率 → 波的周期和频率(等于波源振动周期)"),
        ("x1c3s2k01", "x1c3s2k03", "prerequisite_of", "波长+周期 → 波速公式 v=λ/T=λf"),
        ("x1c3s1k02", "x1c3s2k04", "prerequisite_of", "横波概念 → 波的图像(y-x图，某时刻各质点位移)"),
        ("x1c2s1k04", "x1c3s2k05", "prerequisite_of", "振动图像(x-t) → 振动图像与波形图的比较(一个质点vs所有质点)"),
        ("x1c3s2k04", "x1c3s2k06", "prerequisite_of", "波形图 → 波传播方向判断(微平移法/上下坡法)"),
        ("x1c3s2k05", "x1c3s2k07", "prerequisite_of", "振动图+波形图 → 振动图与波形图互推"),
        ("x1c3s2k04", "x1c3s2k08", "prerequisite_of", "波形图 → 波的多解问题(传播方向/周期/波长不确定性)"),
        ("x1c3s2k03", "x1c3s3k01", "prerequisite_of", "波速概念 → 波的反射(波在同种介质中遇障碍返回)"),
        ("x1c3s3k01", "x1c3s3k02", "prerequisite_of", "波的反射 → 波的折射(波从一种介质进入另一种介质)"),
        ("x1c3s1k02", "x1c3s3k03", "prerequisite_of", "波的本质 → 波的衍射(波绕过障碍物)"),
        ("x1c3s3k03", "x1c3s3k04", "prerequisite_of", "波的衍射 → 明显衍射条件(障碍物尺寸≈波长)"),
        ("x1c3s1k03", "x1c3s4k01", "prerequisite_of", "波传播的是振动 → 波的叠加原理(位移矢量和)"),
        ("x1c3s4k01", "x1c3s4k02", "prerequisite_of", "波的叠加 → 稳定干涉条件(频率相同+相位差恒定)"),
        ("x1c3s4k02", "x1c3s4k03", "prerequisite_of", "干涉条件 → 加强区和减弱区(波程差Δr=nλ加强/(n+½)λ减弱)"),
        ("x1c3s2k03", "x1c3s5k01", "prerequisite_of", "波速/频率 → 多普勒效应(波源与观察者相对运动)"),
        ("x1c3s5k01", "x1c3s5k02", "prerequisite_of", "多普勒效应 → 靠近时频率升高"),
        ("x1c3s5k01", "x1c3s5k03", "prerequisite_of", "多普勒效应 → 远离时频率降低"),
    ]

    # ── 第四章 光 ──
    x1_ch4 = [
        ("x1c3s3k02", "x1c4s1k01", "prerequisite_of", "波的折射概念 → 光的折射(光从一种介质进入另一种介质)"),
        ("x1c4s1k01", "x1c4s1k02", "prerequisite_of", "光的折射 → 折射定律 n₁sinθ₁=n₂sinθ₂"),
        ("x1c4s1k02", "x1c4s1k03", "prerequisite_of", "折射定律 → 折射率 n=c/v(光在介质中速度减小)"),
        ("x1c4s1k02", "x1c4s1k04", "prerequisite_of", "折射定律 → 光路可逆原理"),
        ("x1c4s1k03", "x1c4s1k05", "prerequisite_of", "折射率 → 测量玻璃折射率(插针法)"),
        ("x1c4s1k02", "x1c4s2k01", "prerequisite_of", "折射定律 → 全反射条件(光密→光疏+入射角≥临界角)"),
        ("x1c4s2k01", "x1c4s2k02", "prerequisite_of", "全反射条件 → 临界角 sinC=1/n"),
        ("x1c4s2k01", "x1c4s2k03", "prerequisite_of", "全反射 → 全反射棱镜(等腰直角棱镜)"),
        ("x1c4s2k01", "x1c4s2k04", "prerequisite_of", "全反射 → 光导纤维(内芯+外套，全反射传播)"),
        ("x1c3s4k01", "x1c4s3k01", "prerequisite_of", "波的叠加原理 → 光的干涉(双缝/薄膜)"),
        ("x1c3s4k02", "x1c4s3k02", "prerequisite_of", "波的干涉条件 → 相干光条件(频率相同+相位差恒定)"),
        ("x1c4s3k01", "x1c4s3k03", "prerequisite_of", "光的干涉 → 双缝干涉条纹 Δx=Lλ/d"),
        ("x1c4s3k03", "x1c4s4k01", "prerequisite_of", "双缝干涉条纹 → 双缝测波长原理 λ=dΔx/L"),
        ("x1c4s4k01", "x1c4s4k02", "prerequisite_of", "测波长原理 → 条纹间距测量"),
        ("x1c4s4k02", "x1c4s4k03", "prerequisite_of", "条纹间距测量 → 测量头读数(螺旋测微器原理)"),
        ("x1c4s4k01", "x1c4s4k04", "prerequisite_of", "实验原理 → 双缝实验误差来源分析"),
        ("x1c3s3k03", "x1c4s5k01", "prerequisite_of", "波的衍射 → 光的衍射(光绕过障碍物/狭缝)"),
        ("x1c4s5k01", "x1c4s5k02", "prerequisite_of", "光的衍射 → 单缝衍射(中央亮纹最宽)"),
        ("x1c4s5k01", "x1c4s5k04", "prerequisite_of", "光的衍射 → 干涉图样与衍射图样的比较"),
        ("x1c3s1k02", "x1c4s6k01", "prerequisite_of", "横波概念 → 光的偏振(横波特有的现象)"),
        ("x1c4s6k01", "x1c4s6k02", "prerequisite_of", "光的偏振 → 偏振片(只允许特定方向振动通过)"),
        ("x1c4s6k01", "x1c4s6k03", "prerequisite_of", "光的偏振 → 自然光(各方向振动均匀)和偏振光"),
    ]

    # ── x1 跨册前置 ──
    x1_from_other = [
        ("v1c3s1k01", "x1c1s1k01", "prerequisite_of", "质量和速度概念 → 动量 p=mv"),
        ("v1c4s3k01", "x1c1s2k02", "prerequisite_of", "牛顿第二定律 F=ma → 动量定理 Ft=mv'-mv(牛二的时间积累)"),
        ("v1c4s4k01", "x1c1s1k03", "prerequisite_of", "力学单位制 → 动量单位 kg·m/s"),
        ("v2c8s3k01", "x1c1s1k03", "prerequisite_of", "动能概念 → 动量与动能的比较(Ek=p²/2m)"),
        ("v2c8s4k02", "x1c1s3k01", "prerequisite_of", "机械能守恒条件 → 动量守恒条件(不同！易混)"),
        ("v2c8s4k03", "x1c1s5k04", "prerequisite_of", "机械能守恒 → 弹性碰撞中的能量分析"),
        ("v2c6s2k02", "x1c2s3k03", "prerequisite_of", "向心力公式 → 弹簧振子运动的回复力机制理解"),
        ("v2c6s4k05", "x1c2s3k03", "prerequisite_of", "圆周运动临界 → 单摆回复力的切向分量分析"),
        ("v2c8s4k04", "x1c2s3k04", "prerequisite_of", "机械能守恒单体 → 振动中的能量转化(Ek↔Ep)"),
        ("v1c1s3k03", "x1c3s2k03", "prerequisite_of", "匀速直线运动 → 波速=波长/周期"),
        ("v2c6s1k02", "x1c4s2k03", "prerequisite_of", "线速度方向(切线) → 全反射时入射角与临界角关系"),
    ]

    # ── x1 易混点 ──
    x1_confused = [
        ("x1c1s1k01", "x1c1s1k03", "confused_with", "动量(矢量)vs动能(标量)——守恒条件完全不同，Ek=p²/(2m)联系二者"),
        ("x1c1s3k01", "x1c1s3k06", "confused_with", "系统动量守恒(合外力=0)vs某方向动量守恒(该方向合力=0)——全局vs方向"),
        ("x1c1s2k02", "x1c1s2k05", "confused_with", "动量定理(过程)vs牛顿第二定律(瞬时)——Ft=Δp是F=ma的积分形式"),
        ("x1c1s5k01", "x1c1s5k03", "confused_with", "弹性碰撞(动能守恒)vs完全非弹性碰撞(动能损失最大)"),
        ("x1c2s1k04", "x1c3s2k04", "confused_with", "振动图像(x-t，一个质点)vs波形图(y-x，所有质点)——横坐标含义根本不同"),
        ("x1c2s2k02", "x1c3s2k02", "confused_with", "振动周期(质点)vs波的周期(等于波源振动周期)——波传播中每个质点振动周期相同"),
        ("x1c3s3k03", "x1c3s4k01", "confused_with", "波的衍射(绕过障碍)vs波的干涉(两波叠加)——不同现象，产生条件不同"),
        ("x1c4s1k02", "x1c4s2k01", "confused_with", "折射(光密→光疏，折射角>入射角)vs全反射(入射角≥临界角)——全反射是折射的特殊情况"),
        ("x1c4s3k03", "x1c4s5k02", "confused_with", "双缝干涉(等间距条纹)vs单缝衍射(中央亮纹最宽)——图样特征不同"),
        ("x1c4s1k03", "x1c4s2k02", "confused_with", "折射率n(光在介质中速度c/n)vs临界角(sinC=1/n)——n越大C越小"),
        ("x1c2s3k03", "x1c2s4k01", "confused_with", "弹簧振子(竖直/水平)vs单摆——回复力本质不同(F=-kx vs 重力切向分力)"),
        ("x1c1s3k01", "x1c1s6k01", "confused_with", "系统动量守恒(碰撞)vs反冲(也是动量守恒)——前者碰后分开，后者原为一体后分开"),
        ("x1c2s4k03", "x1c2s5k01", "confused_with", "单摆周期公式 T=2π√(L/g)——周期只与L和g有关，与振幅和质量无关"),
        ("x1c3s5k01", "x1c3s2k03", "confused_with", "多普勒效应(接收频率变化)vs波速不变——波在介质中速度不变，但接收频率改变"),
        ("x1c2s6k03", "x1c2s6k04", "confused_with", "共振(驱动频率=固有频率→振幅最大)——利用(乐器)vs防止(桥梁)"),
    ]

    x1_all = x1_ch1 + x1_ch2 + x1_ch3 + x1_ch4 + x1_from_other + x1_confused

    # =========================================================================
    # 选择性必修第二册 (x2) — 安培力·洛伦兹力 / 电磁感应 / 交变电流 / 电磁振荡 / 传感器
    # =========================================================================

    # ── 第一章 安培力与洛伦兹力 ──
    x2_ch1 = [
        ("x2c1s1k01", "x2c1s1k03", "prerequisite_of", "安培力存在条件 → 安培力大小 F=BILsinθ"),
        ("x2c1s1k01", "x2c1s1k02", "prerequisite_of", "安培力存在条件 → 左手定则(判断安培力方向)"),
        ("x2c1s1k03", "x2c1s1k04", "prerequisite_of", "安培力公式 → 磁感应强度的力学定义 B=F/(IL)"),
        ("x2c1s1k02", "x2c1s1k05", "prerequisite_of", "左手定则+安培力 → 安培力作用下导体棒平衡(三维受力)"),
        ("x2c1s1k03", "x2c1s1k06", "prerequisite_of", "安培力公式 → 安培力做功与能量转化(电能↔机械能)"),
        ("x2c1s1k01", "x2c1s2k01", "prerequisite_of", "安培力(宏观) → 洛伦兹力(微观)——安培力是洛伦兹力的宏观合力表现"),
        ("x2c1s2k01", "x2c1s2k03", "prerequisite_of", "洛伦兹力存在条件 → 洛伦兹力大小 f=qvBsinθ"),
        ("x2c1s1k02", "x2c1s2k02", "prerequisite_of", "左手定则(安培力) → 左手定则(洛伦兹力)——正电荷四指指v，负电荷指v反方向"),
        ("x2c1s2k03", "x2c1s2k04", "prerequisite_of", "洛伦兹力公式 → f⊥v恒成立→洛伦兹力永不做功"),
        ("x2c1s2k01", "x2c1s2k05", "prerequisite_of", "洛伦兹力+安培力 → 电场力与洛伦兹力比较(F电可做功/f洛不做功)"),
        ("x2c1s2k03", "x2c1s3k01", "prerequisite_of", "洛伦兹力 → v⊥B时洛伦兹力提供向心力→匀速圆周运动"),
        ("x2c1s3k01", "x2c1s3k02", "prerequisite_of", "磁场圆周运动模型 → 半径公式 r=mv/(qB)"),
        ("x2c1s3k01", "x2c1s3k03", "prerequisite_of", "磁场圆周运动模型 → 周期公式 T=2πm/(qB)(与v无关)"),
        ("x2c1s3k02", "x2c1s3k04", "prerequisite_of", "半径公式 → 轨迹几何方法(定圆心→求半径→算时间)"),
        ("x2c1s3k02", "x2c1s3k05", "prerequisite_of", "半径公式 → 有界磁场中的临界问题(相切/最值)"),
        ("x2c1s3k02", "x2c1s3k06", "prerequisite_of", "半径公式 → 复合场中的速度选择器(v=E/B)"),
        ("x2c1s3k01", "x2c1s4k01", "prerequisite_of", "磁场圆周运动 → 质谱仪基本原理(加速+偏转)"),
        ("x2c1s4k01", "x2c1s4k02", "prerequisite_of", "质谱仪原理 → 质谱仪公式联立(电场加速+磁场偏转)"),
        ("x2c1s3k03", "x2c1s4k03", "prerequisite_of", "周期公式T与v无关 → 回旋加速器原理(交变电场周期=T)"),
        ("x2c1s4k03", "x2c1s4k04", "prerequisite_of", "回旋加速器原理 → 最大动能(由D形盒半径决定)"),
    ]

    # ── 第二章 电磁感应 ──
    x2_ch2 = [
        ("x2c2s1k04", "x2c2s1k05", "prerequisite_of", "楞次定律表述 → 方向判断四步法(B原→Φ增减→B感→安培定则)"),
        ("x2c2s1k04", "x2c2s1k07", "prerequisite_of", "楞次定律 → 阻碍≠阻止——只能减缓Φ变化，不能完全阻止"),
        ("x2c2s2k01", "x2c2s2k02", "prerequisite_of", "感应电动势 → 法拉第电磁感应定律 E=nΔΦ/Δt"),
        ("x2c2s2k02", "x2c2s2k03", "prerequisite_of", "法拉第定律 → 动生电动势 E=BLv(导体切割磁感线)"),
        ("x2c2s2k02", "x2c2s2k04", "prerequisite_of", "法拉第定律 → 感应电荷量 q=nΔΦ/R(与Δt无关)"),
        ("x2c2s2k01", "x2c2s2k05", "prerequisite_of", "感应电动势 → 电磁感应电路计算(等效电源模型)"),
        ("x2c2s2k02", "x2c2s2k06", "prerequisite_of", "法拉第定律 → 电磁感应图像问题(B-t→Φ-t→E-t→I-t→F安-t→v-t)"),
        ("x2c2s2k05", "x2c2s2k07", "prerequisite_of", "电磁感应电路 → 电磁感应动力学综合(导轨+导体棒)"),
        ("x2c2s2k02", "x2c2s3k01", "prerequisite_of", "法拉第定律 → 涡流(块状金属在变化磁场中感生电流)"),
        ("x2c2s3k01", "x2c2s3k03", "prerequisite_of", "涡流 → 电磁阻尼(涡流受安培力阻碍运动)"),
        ("x2c2s3k01", "x2c2s3k04", "prerequisite_of", "涡流 → 电磁驱动(旋转磁场驱动金属)"),
        ("x2c2s1k06", "x2c2s4k01", "prerequisite_of", "电磁感应基础 → 互感现象(两个线圈之间的电磁感应)"),
        ("x2c2s4k01", "x2c2s4k02", "prerequisite_of", "互感 → 自感现象(线圈自身电流变化产生感应电动势)"),
        ("x2c2s4k02", "x2c2s4k03", "prerequisite_of", "自感现象 → 自感电动势方向(阻碍原电流变化)"),
        ("x2c2s4k02", "x2c2s4k04", "prerequisite_of", "自感现象 → 自感线圈电路暂态过程(通断瞬间)"),
    ]

    # ── 第三章 交变电流 ──
    x2_ch3 = [
        ("x2c2s2k03", "x2c3s1k01", "prerequisite_of", "动生电动势(E=BLv) → 交变电流的产生(线圈在磁场中转动)"),
        ("x2c3s1k01", "x2c3s1k02", "prerequisite_of", "交变电流概念 → 正弦交变电流的产生(矩形线圈在匀强磁场中匀速转动)"),
        ("x2c3s1k02", "x2c3s1k03", "prerequisite_of", "正弦交变电流产生 → 瞬时值表达式 e=Emsinωt"),
        ("x2c3s1k02", "x2c3s1k04", "prerequisite_of", "正弦交变电流产生 → 中性面(Φ最大/e=0)"),
        ("x2c3s1k03", "x2c3s2k02", "prerequisite_of", "瞬时值表达式 → 峰值Em=NBSω与有效值E=Em/√2"),
        ("x2c3s2k02", "x2c3s2k03", "prerequisite_of", "峰值与有效值 → 平均值(对应ΔΦ/Δt)"),
        ("x2c3s2k02", "x2c3s2k04", "prerequisite_of", "有效值 → 交流功率计算 P=UIcosφ"),
        ("x2c2s4k02", "x2c3s2k05", "prerequisite_of", "自感 → 电感对交流的阻碍(感抗 XL=2πfL)"),
        ("x2c3s2k05", "x2c3s2k06", "prerequisite_of", "电感对交流阻碍 → 电容对交流的阻碍(容抗 XC=1/(2πfC))"),
        ("x2c2s4k01", "x2c3s3k01", "prerequisite_of", "互感现象 → 变压器工作原理(互感实现电压变换)"),
        ("x2c3s3k01", "x2c3s3k02", "prerequisite_of", "变压器原理 → 理想变压器电压关系 U₁/U₂=n₁/n₂"),
        ("x2c3s3k02", "x2c3s3k03", "prerequisite_of", "电压关系 → 电流关系 I₁/I₂=n₂/n₁(单副线圈P₁=P₂)"),
        ("x2c3s3k02", "x2c3s3k04", "prerequisite_of", "电压关系 → 变压器负载变化动态分析(U₂不变→I₂变→I₁变)"),
        ("x2c3s3k02", "x2c3s3k05", "prerequisite_of", "电压关系 → 多副线圈变压器(用功率守恒P入=P出)"),
        ("x2c3s3k01", "x2c3s4k01", "prerequisite_of", "变压器(升压/降压) → 输电线损耗 P损=I²R"),
        ("x2c3s4k01", "x2c3s4k02", "prerequisite_of", "输电线损耗 → 高压输电(减小电流减小损耗)"),
        ("x2c3s4k02", "x2c3s4k03", "prerequisite_of", "高压输电原理 → 远距离输电模型(升压→输电→降压)"),
        ("x2c3s4k03", "x2c3s4k04", "prerequisite_of", "远距离输电模型 → 输电效率计算"),
    ]

    # ── 第四章 电磁振荡与电磁波 ──
    x2_ch4 = [
        ("x2c3s3k01", "x2c4s1k01", "prerequisite_of", "互感/自感 → LC振荡电路(电容器和电感线圈组成)"),
        ("x2c4s1k01", "x2c4s1k02", "prerequisite_of", "LC振荡电路 → 电磁振荡过程(q↔i，电场能↔磁场能)"),
        ("x2c4s1k02", "x2c4s1k03", "prerequisite_of", "电磁振荡过程 → 振荡周期 T=2π√(LC)"),
        ("x2c4s1k01", "x2c4s2k01", "prerequisite_of", "LC振荡 → 麦克斯韦电磁场思想(变化的电场产生磁场)"),
        ("x2c4s2k01", "x2c4s2k02", "prerequisite_of", "麦克斯韦理论 → 电磁波形成(交替变化的E和B在空间传播)"),
        ("x2c4s2k02", "x2c4s3k01", "prerequisite_of", "电磁波形成 → 有效发射电磁波条件(高频+开放电路)"),
        ("x2c4s3k01", "x2c4s3k02", "prerequisite_of", "发射条件 → 调制(调幅/调频——将信号加载到载波)"),
        ("x2c4s3k02", "x2c4s3k04", "prerequisite_of", "调制 → 解调(从已调波中提取原信号)"),
        ("x2c4s3k01", "x2c4s3k03", "prerequisite_of", "发射条件 → 调谐与共振(电谐振——接收特定频率)"),
        ("x2c4s2k02", "x2c4s4k01", "prerequisite_of", "电磁波传播 → 电磁波谱整体认识"),
        ("x2c4s4k01", "x2c4s4k02", "prerequisite_of", "电磁波谱 → 波长/频率/能量关系(c=λf, E=hν)"),
    ]

    # ── 第五章 传感器 ──
    x2_ch5 = [
        ("x2c5s1k01", "x2c5s1k02", "prerequisite_of", "传感器概念 → 传感器系统组成(敏感元件/转换元件/转换电路)"),
        ("x2c3s2k05", "x2c5s2k01", "prerequisite_of", "电阻概念 → 光敏电阻(光照强度→电阻变化)"),
        ("x2c3s2k05", "x2c5s2k02", "prerequisite_of", "电阻概念 → 热敏电阻(温度→电阻变化)"),
        ("x2c1s2k02", "x2c5s2k05", "prerequisite_of", "洛伦兹力方向判断 → 霍尔元件(磁场→霍尔电压)"),
        ("x2c3s4k01", "x2c5s2k07", "prerequisite_of", "电路分析方法 → 传感器电路分析"),
        ("x2c5s1k01", "x2c5s3k01", "prerequisite_of", "传感器概念 → 自动控制基本逻辑(输入→处理→输出)"),
        ("x2c5s3k01", "x2c5s3k02", "prerequisite_of", "自动控制逻辑 → 继电器控制(弱电控制强电)"),
    ]

    # ── x2 跨章节前置 ──
    x2_cross = [
        ("x2c1s2k03", "x2c2s2k03", "prerequisite_of", "洛伦兹力 → 动生电动势的微观解释(移动电荷受洛伦兹力)"),
        ("x2c2s2k02", "x2c3s1k02", "prerequisite_of", "法拉第电磁感应定律 → 正弦交变电流 e=NBSωsinωt"),
        ("x2c2s2k03", "x2c2s2k07", "prerequisite_of", "动生电动势(E=BLv) → 导轨+导体棒动力学综合"),
        ("x2c1s1k03", "x2c2s2k07", "prerequisite_of", "安培力公式 → 电磁感应动力学中的安培力 F安=BIL"),
        ("x2c2s1k07", "x2c2s2k07", "prerequisite_of", "楞次定律 → 电磁感应动力学综合(安培力阻碍运动)"),
    ]

    # ── x2 跨册前置（从必修三和必修二） ──
    x2_from_other = [
        ("v3c13s2k01", "x2c1s1k04", "prerequisite_of", "磁感应强度B → B的力学定义 F=BIL (必修三初步→选必二深入)"),
        ("v3c13s2k01", "x2c1s3k02", "prerequisite_of", "磁感应强度B → 带电粒子圆周运动半径 r=mv/(qB)"),
        ("v3c13s1k05", "x2c1s1k02", "prerequisite_of", "安培定则(电流→磁场) → 左手定则(磁场+电流→力)——两种定则的区分"),
        ("v3c12s2k03", "x2c2s2k05", "prerequisite_of", "闭合电路欧姆定律 → 电磁感应电路计算(等效电源)"),
        ("v3c12s2k05", "x2c2s2k07", "prerequisite_of", "电源输出功率分析 → 电磁感应动力学中的功率关系"),
        ("v2c6s2k02", "x2c1s3k01", "prerequisite_of", "向心力公式 → 磁场中带电粒子的匀速圆周运动 F向=qvB=mv²/r"),
        ("v2c6s2k04", "x2c1s3k04", "prerequisite_of", "圆周运动受力分析 → 磁场圆周运动的轨迹几何(找圆心)"),
        ("v2c8s4k03", "x2c2s2k07", "prerequisite_of", "能量守恒方法 → 电磁感应动力学中的能量转化(E电→E机+Q)"),
        ("v1c3s4k01", "x2c1s1k05", "prerequisite_of", "受力分析(矢量方法) → 三维安培力平衡问题"),
        ("v1c4s3k01", "x2c1s1k05", "prerequisite_of", "牛顿第二定律 → 导体棒在安培力作用下的加速/平衡"),
        ("v3c11s4k01", "x2c5s2k07", "prerequisite_of", "串联/并联电路分析 → 传感器电路分析(分压/桥式电路)"),
    ]

    # ── x2 易混点 ──
    x2_confused = [
        ("x2c1s1k02", "x2c2s1k06", "confused_with", "左手定则(判断安培力方向)vs右手定则(判断感应电流方向)——'力'左'电'右"),
        ("x2c1s1k03", "x2c1s2k03", "confused_with", "安培力 F=BIL(宏观，通电导线)vs洛伦兹力 f=qvB(微观，单个电荷)"),
        ("x2c1s2k04", "x2c1s1k06", "confused_with", "洛伦兹力永不做功(v⊥f)vs安培力可做正功/负功——微观与宏观的'悖论'理解"),
        ("x2c2s1k07", "x2c2s2k02", "confused_with", "楞次定律(方向判断)vs法拉第定律(大小计算)——阻碍vs变化率"),
        ("x2c2s2k03", "x2c2s2k02", "confused_with", "动生电动势(E=BLv,切割)vs感生电动势(E=nΔΦ/Δt)——本质都是ΔΦ/Δt"),
        ("x2c3s2k02", "x2c3s2k03", "confused_with", "有效值(等效热效应)vs最大值(峰值)vs平均值(对应ΔΦ/Δt)——各有用处"),
        ("x2c3s3k02", "x2c3s3k03", "confused_with", "变压器原副线圈电压关系(U₁/n₁=U₂/n₂)vs电流关系(单副线圈I₁/I₂=n₂/n₁)——输入决定输出"),
        ("x2c2s3k03", "x2c2s3k04", "confused_with", "电磁阻尼(阻碍运动)vs电磁驱动(驱动运动)——都源于楞次定律"),
        ("x2c2s4k02", "x2c2s4k04", "confused_with", "自感(线圈自身电流变化)vs互感(两线圈之间)——本质都是电磁感应"),
        ("x2c3s2k05", "x2c3s2k06", "confused_with", "感抗(XL=2πfL,通低频阻高频)vs容抗(XC=1/(2πfC),通高频阻低频)——频率特性相反"),
        ("x2c1s3k02", "x2c1s3k03", "confused_with", "磁场圆周运动半径 r=mv/(qB)(与v有关)vs周期 T=2πm/(qB)(与v无关)——回旋加速器理论基础"),
    ]

    x2_all = x2_ch1 + x2_ch2 + x2_ch3 + x2_ch4 + x2_ch5 + x2_cross + x2_from_other + x2_confused

    # =========================================================================
    # 选择性必修第三册 (x3) — 热学 / 近代物理
    # =========================================================================

    # ── 第一章 分子动理论 ──
    x3_ch1 = [
        ("x3c1s1k01", "x3c1s1k04", "prerequisite_of", "分子动理论 → 布朗运动(悬浮微粒运动反映分子热运动)"),
        ("x3c1s1k01", "x3c1s1k05", "prerequisite_of", "分子动理论 → 分子热运动(温度越高越剧烈)"),
        ("x3c1s1k01", "x3c1s1k06", "prerequisite_of", "分子动理论 → 分子间作用力(引力+斥力)"),
        ("x3c1s1k06", "x3c1s1k07", "prerequisite_of", "分子间作用力 → 分子力与距离关系(斥力/引力主导区域)"),
        ("x3c1s1k01", "x3c1s1k02", "prerequisite_of", "分子动理论 → 阿伏伽德罗常量(联系宏观与微观)"),
        ("x3c1s1k02", "x3c1s1k03", "prerequisite_of", "阿伏伽德罗常量 → 微观量估算(分子质量/体积/间距)"),
        ("x3c1s1k01", "x3c1s2k01", "prerequisite_of", "分子动理论 → 油膜法实验(分子大小的测量)"),
        ("x3c1s2k01", "x3c1s2k02", "prerequisite_of", "油膜法思想 → 油酸体积换算(浓度×滴数×每滴体积)"),
        ("x3c1s2k01", "x3c1s2k03", "prerequisite_of", "油膜法思想 → 油膜面积估算(方格纸法)"),
        ("x3c1s2k02", "x3c1s2k04", "prerequisite_of", "体积换算+面积估算 → 油膜法误差分析"),
        ("x3c1s1k05", "x3c1s3k01", "prerequisite_of", "分子热运动(大量分子) → 统计规律(个别分子不可预测)"),
        ("x3c1s3k01", "x3c1s3k02", "prerequisite_of", "统计规律 → 分子速率分布(最概然速率)"),
        ("x3c1s1k05", "x3c1s3k03", "prerequisite_of", "分子热运动 → 温度对速率分布的影响(温度↑→高速分子比例↑)"),
        ("x3c1s3k02", "x3c1s3k04", "prerequisite_of", "速率分布 → 气体压强微观解释(碰撞→压强)"),
        ("x3c1s1k05", "x3c1s4k01", "prerequisite_of", "分子热运动 → 分子平均动能(温度是标志)"),
        ("x3c1s1k06", "x3c1s4k02", "prerequisite_of", "分子间作用力 → 分子势能(由分子相对位置决定)"),
        ("x3c1s4k01", "x3c1s4k03", "prerequisite_of", "分子平均动能+分子势能 → 内能概念"),
        ("x3c1s4k03", "x3c1s4k04", "prerequisite_of", "内能概念 → 内能影响因素(温度/体积/物质的量/物态)"),
        ("x3c1s4k03", "x3c1s4k05", "prerequisite_of", "内能(微观) → 内能与机械能(宏观)的比较"),
    ]

    # ── 第二章 气体、固体和液体 ──
    x3_ch2 = [
        ("x3c1s4k01", "x3c2s1k02", "prerequisite_of", "分子平均动能 → 温度是分子平均动能的标志"),
        ("x3c2s1k01", "x3c2s1k02", "prerequisite_of", "热平衡 → 温度概念(互为热平衡的系统温度相等)"),
        ("x3c2s1k02", "x3c2s1k03", "prerequisite_of", "温度概念 → 摄氏温标与热力学温标 T=t+273.15K"),
        ("x3c2s1k02", "x3c2s2k01", "prerequisite_of", "温度概念 → 等温变化(温度不变时的状态变化)"),
        ("x3c2s2k01", "x3c2s2k02", "prerequisite_of", "等温变化 → 玻意耳定律 pV=C(等温)"),
        ("x3c2s2k02", "x3c2s2k03", "prerequisite_of", "玻意耳定律 → p-V图像(等温线为双曲线)"),
        ("x3c2s2k02", "x3c2s2k04", "prerequisite_of", "玻意耳定律 → 等温变化实验验证"),
        ("x3c2s2k02", "x3c2s2k05", "prerequisite_of", "玻意耳定律 → 气柱模型(液柱封闭气体)"),
        ("x3c2s1k03", "x3c2s3k01", "prerequisite_of", "热力学温标 → 等压变化(V∝T)"),
        ("x3c2s3k01", "x3c2s3k02", "prerequisite_of", "等压变化 → 盖吕萨克定律 V/T=C"),
        ("x3c2s1k03", "x3c2s3k03", "prerequisite_of", "热力学温标 → 等容变化(p∝T)"),
        ("x3c2s3k03", "x3c2s3k04", "prerequisite_of", "等容变化 → 查理定律 p/T=C"),
        ("x3c2s2k02", "x3c2s3k05", "prerequisite_of", "玻意耳定律+盖吕萨克+查理 → 理想气体状态方程 pV/T=C"),
        ("x3c2s3k05", "x3c2s3k06", "prerequisite_of", "理想气体状态方程 → 理想气体模型(忽略分子体积/分子力)"),
        ("x3c2s3k06", "x3c2s3k07", "prerequisite_of", "理想气体模型 → 气体状态变化综合(选择定律/方程)"),
        ("x3c2s3k06", "x3c3s2k03", "prerequisite_of", "理想气体内能只取决于温度 → 等温过程ΔU=0→Q=-W"),
    ]

    # ── 第三章 热力学定律 ──
    x3_ch3 = [
        ("x3c1s4k03", "x3c3s1k01", "prerequisite_of", "内能概念 → 改变内能的两种方式(做功+热传递)"),
        ("x3c3s1k01", "x3c3s1k02", "prerequisite_of", "两种方式 → 做功改变内能(外界对系统做功→ΔU↑)"),
        ("x3c3s1k01", "x3c3s1k03", "prerequisite_of", "两种方式 → 热传递改变内能(热量是过程量)"),
        ("x3c3s1k02", "x3c3s1k04", "prerequisite_of", "做功改变内能 → 功和热量比较(都是过程量，内能是状态量)"),
        ("x3c3s1k01", "x3c3s2k01", "prerequisite_of", "做功+热传递 → 热力学第一定律 ΔU=W+Q"),
        ("x3c3s2k01", "x3c3s2k02", "prerequisite_of", "热力学第一定律 → 符号规则(W/Q/ΔU正负)"),
        ("x3c3s2k01", "x3c3s2k03", "prerequisite_of", "ΔU=W+Q → 等温过程能量分析(ΔU=0)"),
        ("x3c3s2k01", "x3c3s2k04", "prerequisite_of", "ΔU=W+Q → 等容过程能量分析(W=0)"),
        ("x3c3s2k01", "x3c3s2k05", "prerequisite_of", "ΔU=W+Q → 等压过程能量分析(Q=ΔU+W)"),
        ("x3c3s2k03", "x3c3s2k06", "prerequisite_of", "各过程分析 → 理想气体热力学第一定律总结(三过程统一)"),
        ("x3c3s2k01", "x3c3s3k01", "prerequisite_of", "热力学第一定律 → 能量守恒定律(热学中的体现)"),
        ("x3c3s3k01", "x3c3s3k02", "prerequisite_of", "能量守恒 → 第一类永动机不可能"),
        ("x3c3s3k01", "x3c3s3k03", "prerequisite_of", "能量守恒 → 热机能量转化(内能→机械能+散失)"),
        ("x3c3s2k01", "x3c3s4k01", "prerequisite_of", "热力学第一定律 → 热传导方向性(引出第二定律)"),
        ("x3c3s4k01", "x3c3s4k02", "prerequisite_of", "热传导方向性 → 机械能和内能转化的方向性"),
        ("x3c3s4k02", "x3c3s4k03", "prerequisite_of", "转化方向性 → 第二类永动机不可能(单一热源吸热→全做功)"),
        ("x3c3s4k01", "x3c3s4k04", "prerequisite_of", "过程方向性 → 熵和无序性定性认识"),
    ]

    # ── 第四章 原子结构和波粒二象性 ──
    x3_ch4 = [
        ("x3c4s1k01", "x3c4s1k02", "prerequisite_of", "黑体辐射 → 经典物理困难(紫外灾难)"),
        ("x3c4s1k02", "x3c4s1k03", "prerequisite_of", "经典物理困难 → 能量子 ε=hν(普朗克假设)"),
        ("x3c4s1k03", "x3c4s2k01", "prerequisite_of", "能量子 → 光电效应(光子能量与电子逸出)"),
        ("x3c4s2k01", "x3c4s2k02", "prerequisite_of", "光电效应现象 → 实验规律(截止频率/瞬时性/最大初动能)"),
        ("x3c4s1k03", "x3c4s2k03", "prerequisite_of", "能量子 → 光子 E=hν"),
        ("x3c4s2k03", "x3c4s2k04", "prerequisite_of", "光子概念 → 爱因斯坦光电效应方程 hν=Ek+W₀"),
        ("x3c4s2k04", "x3c4s2k05", "prerequisite_of", "光电效应方程 → 遏止电压 eUc=Ekmax"),
        ("x3c4s2k03", "x3c4s3k01", "prerequisite_of", "光子(能量) → 康普顿效应(光子有动量)"),
        ("x3c4s3k01", "x3c4s3k02", "prerequisite_of", "康普顿效应 → 光子动量 p=h/λ"),
        ("x3c4s2k01", "x3c4s3k03", "prerequisite_of", "光电效应(粒子性)+干涉(波动性) → 光的波粒二象性"),
        ("x3c4s3k03", "x3c4s4k01", "prerequisite_of", "光的波粒二象性 → 汤姆孙原子模型(枣糕模型)——电子发现后的尝试"),
        ("x3c4s4k01", "x3c4s4k02", "prerequisite_of", "汤姆孙模型 → α粒子散射实验(少数大角度偏转)"),
        ("x3c4s4k02", "x3c4s4k03", "prerequisite_of", "α粒子散射实验 → 卢瑟福核式结构(质量/正电荷集中在原子核)"),
        ("x3c4s4k03", "x3c4s4k04", "prerequisite_of", "核式结构 → 经典电磁理论的局限(无法解释稳定性+线状光谱)"),
        ("x3c4s4k04", "x3c4s5k01", "prerequisite_of", "核式结构局限 → 氢原子光谱(线状谱，说明能量分立)"),
        ("x3c4s5k01", "x3c4s5k02", "prerequisite_of", "氢原子光谱 → 玻尔定态假设(稳定能量状态)"),
        ("x3c4s5k02", "x3c4s5k03", "prerequisite_of", "定态假设 → 跃迁假设 hν=Em-En"),
        ("x3c4s5k03", "x3c4s5k04", "prerequisite_of", "跃迁假设 → 能级图与光谱分析(谱线计数/巴尔末系)"),
        ("x3c4s1k03", "x3c4s6k01", "prerequisite_of", "能量子(光的粒子性) → 德布罗意物质波(实物粒子也有波动性)"),
        ("x3c4s6k01", "x3c4s6k02", "prerequisite_of", "物质波假设 → 电子衍射实验验证"),
    ]

    # ── 第五章 原子核 ──
    x3_ch5 = [
        ("x3c5s1k01", "x3c5s1k02", "prerequisite_of", "质子和中子 → 原子序数和质量数(Z=质子数, A=质子数+中子数)"),
        ("x3c5s1k02", "x3c5s1k03", "prerequisite_of", "原子序数和质量数 → 同位素(质子数相同/中子数不同)"),
        ("x3c5s1k02", "x3c5s1k04", "prerequisite_of", "质量数和电荷数 → 核反应方程守恒(质量数守恒+电荷数守恒)"),
        ("x3c5s1k04", "x3c5s2k01", "prerequisite_of", "核反应方程 → 天然放射现象(自发核变化)"),
        ("x3c5s2k01", "x3c5s2k02", "prerequisite_of", "天然放射现象 → α/β/γ射线性质(电离/穿透/偏转)"),
        ("x3c5s1k04", "x3c5s2k03", "prerequisite_of", "核反应方程守恒 → α衰变(放出α粒子，A减4/Z减2)"),
        ("x3c5s1k04", "x3c5s2k04", "prerequisite_of", "核反应方程守恒 → β衰变(中子→质子+电子，A不变/Z加1)"),
        ("x3c5s2k03", "x3c5s2k05", "prerequisite_of", "放射性衰变 → 半衰期(统计规律)"),
        ("x3c5s2k05", "x3c5s2k06", "prerequisite_of", "半衰期概念 → 衰变规律计算(剩余核数/质量)"),
        ("x3c5s1k01", "x3c5s3k01", "prerequisite_of", "核子概念 → 核力(强相互作用，短程力)"),
        ("x3c5s3k01", "x3c5s3k02", "prerequisite_of", "核力 → 结合能(分解核子所需能量)"),
        ("x3c5s3k02", "x3c5s3k03", "prerequisite_of", "结合能 → 质量亏损(Δm对应ΔE=Δmc²)"),
        ("x3c5s3k03", "x3c5s3k04", "prerequisite_of", "质量亏损 → 质能方程 ΔE=Δmc²(1u=931.5MeV/c²)"),
        ("x3c5s3k02", "x3c5s3k05", "prerequisite_of", "结合能 → 比结合能(反映核稳定程度)"),
        ("x3c5s3k04", "x3c5s4k01", "prerequisite_of", "质能方程 → 核裂变(重核分裂→释放能量)"),
        ("x3c5s4k01", "x3c5s4k02", "prerequisite_of", "核裂变 → 链式反应(中子继续引发裂变)"),
        ("x3c5s4k02", "x3c5s4k03", "prerequisite_of", "链式反应 → 核反应堆(可控链式反应)"),
        ("x3c5s3k04", "x3c5s4k04", "prerequisite_of", "质能方程 → 核聚变(轻核结合→释放能量)"),
        ("x3c5s4k01", "x3c5s4k05", "prerequisite_of", "核裂变+核聚变 → 裂变聚变能量比较(比结合能变化)"),
    ]

    # ── x3 跨册前置 ──
    x3_from_other = [
        ("v2c8s1k01", "x3c3s1k02", "prerequisite_of", "功的概念 → 做功改变内能(压缩气体/摩擦生热)"),
        ("v2c8s4k02", "x3c3s4k05", "prerequisite_of", "能量守恒思想 → 能源利用方向性和可持续发展"),
        ("v3c13s5k02", "x3c4s1k03", "prerequisite_of", "能量量子化(v3初步) → 能量子ε=hν(x3深入)"),
        ("v3c13s5k03", "x3c4s2k03", "prerequisite_of", "能量子 → 光子 E=hν"),
        ("v2c6s2k02", "x3c4s4k02", "prerequisite_of", "向心力公式 → α粒子散射的轨迹弯曲理解"),
        ("x1c4s3k01", "x3c4s2k02", "prerequisite_of", "光的干涉(波动性) → 光电效应(粒子性)——光的波粒二象性"),
    ]

    # ── x3 易混点 ──
    x3_confused = [
        ("x3c1s1k04", "x3c1s1k05", "confused_with", "布朗运动(悬浮微粒运动)vs分子热运动(分子本身运动)——布朗运动反映分子热运动，不是分子运动"),
        ("x3c1s4k01", "x3c1s4k03", "confused_with", "分子平均动能(温度标志)vs内能(分子动能+分子势能总和)——温度只决定平均动能"),
        ("x3c1s4k03", "x3c3s1k03", "confused_with", "内能(状态量)vs热量(过程量)——不能说物体'含有'热量"),
        ("x3c2s3k05", "x3c3s2k01", "confused_with", "理想气体状态方程(pV/T=C)vs热力学第一定律(ΔU=W+Q)——状态量关系vs能量变化"),
        ("x3c3s1k02", "x3c3s1k03", "confused_with", "做功和热传递——两者都能改变内能，但本质不同(宏观有序vs微观无序)"),
        ("x3c3s2k01", "x3c3s3k01", "confused_with", "热力学第一定律(能量守恒)vs能量守恒定律——第一定律是热学中的能量守恒"),
        ("x3c4s2k02", "x3c4s5k03", "confused_with", "光电效应(光子→电子逸出)vs跃迁假设(光子→能级跃迁)——不同物理过程，公式相似"),
        ("x3c4s2k04", "x3c4s5k03", "confused_with", "光电效应方程(hν=Ek+W₀)vs跃迁公式(hν=Em-En)——前者光子能量用于逸出功+动能，后者光子能量精确等于能级差"),
        ("x3c5s2k03", "x3c5s2k04", "confused_with", "α衰变(A减4,Z减2)vsβ衰变(A不变,Z加1)——质量数变化规律不同"),
        ("x3c5s3k02", "x3c5s3k05", "confused_with", "结合能(总量)vs比结合能(平均每个核子)——比结合能更能反映核稳定性"),
        ("x3c5s4k01", "x3c5s4k04", "confused_with", "核裂变(重核分裂)vs核聚变(轻核结合)——都能释放能量，但条件完全不同"),
        ("x3c4s4k03", "x3c4s5k02", "confused_with", "卢瑟福核式结构(实验事实)vs玻尔模型(理论假设)——玻尔模型修正了核式结构的局限"),
        ("x3c2s3k06", "x3c3s2k06", "confused_with", "理想气体模型(忽略分子体积/力)vs实际气体——理想气体是近似，高温低压时较准确"),
    ]

    x3_all = x3_ch1 + x3_ch2 + x3_ch3 + x3_ch4 + x3_ch5 + x3_from_other + x3_confused

    # =========================================================================
    # 教师视角补边：消除孤立节点，补足应用/实验/现象类知识点的教学连接
    # =========================================================================
    teacher_supplement = [
        # ── 必修第二册：实验、天体运动史、宇宙速度、理论边界 ──
        ("v2c5s3k02", "v2c5s3k03", "prerequisite_of", "先会处理平抛轨迹数据，才能判断初速度不水平、读数和选点等实验误差"),
        ("v2c7s1k01", "v2c7s1k02", "prerequisite_of", "从地心说和日心说的历史争论进入开普勒第一定律，体现天体运动模型的演化"),
        ("v2c7s1k03", "v2c7s1k04", "prerequisite_of", "开普勒第二定律描述变速运动特征，第三定律进一步建立周期和轨道尺度的定量关系"),
        ("v2c7s4k01", "v2c7s4k02", "prerequisite_of", "第一宇宙速度是理解第二、第三宇宙速度的基础"),
        ("v2c7s5k01", "v2c7s5k02", "prerequisite_of", "先明确牛顿力学适用范围，再引入相对论时空观的必要性"),
        ("v2c7s5k02", "v2c7s5k03", "prerequisite_of", "相对论时空观用于说明科学理论都有适用边界"),
        ("v2c7s2k01", "v2c7s5k01", "applied_to", "万有引力定律的成功和局限共同支撑对牛顿力学适用范围的认识"),
        ("v2c8s2k02", "v2c8s2k04", "prerequisite_of", "理解重力势能后，可类比认识弹性势能也是由相互作用位置决定的势能"),

        # ── 必修第三册：静电、电场能、电路实验、电磁波应用 ──
        ("v3c9s1k05", "v3c9s2k02", "prerequisite_of", "元电荷帮助学生理解库仑定律中电荷量取值的物理含义"),
        ("v3c9s4k02", "v3c9s4k04", "applied_to", "尖端放电是静电除尘、静电喷涂等静电利用的基础现象之一"),
        ("v3c9s4k03", "v3c9s4k05", "applied_to", "静电屏蔽和接地思想是静电危害防护的重要依据"),
        ("v3c10s2k05", "v3c10s3k04", "prerequisite_of", "等势面和电场线垂直关系是分析综合电场图像的基础"),
        ("v3c10s4k02", "v3c10s4k05", "prerequisite_of", "电容定义和充放电关系是理解电容器储能的前提"),
        ("v3c11s1k03", "v3c11s1k05", "prerequisite_of", "宏观电流定义之后，再用微观模型解释电流大小的来源"),
        ("v3c11s3k04", "v3c11s3k06", "applied_to", "螺旋测微器读数直接影响金属丝直径和电阻率计算"),
        ("v3c11s3k05", "v3c11s3k06", "applied_to", "游标卡尺读数用于长度或直径测量，是电阻率实验数据处理的一部分"),
        ("v3c11s5k03", "v3c11s5k05", "prerequisite_of", "理解欧姆表内部有电源后，才能明确测电阻必须断开外电路"),
        ("v3c9s3k03", "v3c13s2k05", "confused_with", "电场强度和磁感应强度都描述场，但受力对象、方向规定和作用规律不同"),
        ("v3c13s3k01", "v3c13s3k05", "applied_to", "电磁感应现象是发电、无线充电和感应加热等应用的共同基础"),
        ("v3c13s4k01", "v3c13s4k03", "applied_to", "赫兹实验用于验证麦克斯韦电磁场理论关于电磁波的预言"),
        ("v3c13s4k02", "v3c13s4k05", "applied_to", "电磁波可以传播能量和信息，是通信、雷达和医学成像等应用的基础"),
        ("v3c13s5k02", "v3c13s5k05", "prerequisite_of", "能量量子化说明经典物理在微观和辐射问题中的局限"),
        ("v3c12s3k02", "v3c12s3k05", "prerequisite_of", "U-I 图像法是数据拟合和异常点判断的基础"),
        ("v3c12s4k01", "v3c12s4k03", "prerequisite_of", "能源分类应建立在能量守恒和能量转化认识基础上"),
        ("v3c12s4k02", "v3c12s4k05", "prerequisite_of", "能量转化方向性是理解可持续发展的物理依据"),

        # ── 选择性必修第一册：动量应用、振动波动图像、光学应用 ──
        ("x1c1s6k02", "x1c1s6k04", "prerequisite_of", "火箭反冲原理是理解连续喷射过程中速度逐步增加的基础"),
        ("x1c2s2k03", "x1c2s2k04", "prerequisite_of", "相位决定振动状态，是理解简谐运动表达式的关键参数"),
        ("x1c2s5k01", "x1c2s5k04", "prerequisite_of", "单摆测 g 的实验原理决定摆长、周期和摆角等误差分析方向"),
        ("x1c3s1k01", "x1c3s1k04", "prerequisite_of", "理解机械波形成后，才能用波前和波线描述波的传播"),
        ("x1c3s4k02", "x1c3s4k04", "applied_to", "稳定干涉条件是解释水波干涉实验图样的基础"),
        ("x1c3s5k01", "x1c3s5k04", "applied_to", "多普勒效应的频率变化规律支撑测速、医学超声和天文观测应用"),
        ("x1c4s3k01", "x1c4s3k04", "applied_to", "薄膜干涉是光的干涉在实际薄膜反射中的应用"),
        ("x1c3s3k04", "x1c4s5k03", "prerequisite_of", "机械波明显衍射条件可迁移到光的衍射条件理解"),
        ("x1c4s6k04", "x1c4s6k05", "applied_to", "激光的单色性、相干性和方向性决定其测距、通信和加工应用"),

        # ── 选择性必修第二册：电磁技术应用、交流图像、传感器 ──
        ("x2c1s3k04", "x2c1s4k05", "applied_to", "带电粒子磁场轨迹几何是磁偏转技术应用的核心模型"),
        ("x2c2s3k01", "x2c2s3k02", "applied_to", "涡流的热效应和阻碍作用分别对应其利用和防止"),
        ("x2c2s4k02", "x2c2s4k05", "prerequisite_of", "自感现象体现线圈电流变化和自感系数，进而引出磁场能量"),
        ("x2c3s1k03", "x2c3s2k01", "prerequisite_of", "正弦交流瞬时值表达式中的角频率需要用周期和频率描述"),
        ("x2c3s2k01", "x2c3s2k07", "prerequisite_of", "示波图像读数需要先识别交流周期和频率"),
        ("x2c4s1k02", "x2c4s1k04", "prerequisite_of", "电磁振荡过程中能量往复转化，进一步区分阻尼振荡和受迫振荡"),
        ("x2c4s2k02", "x2c4s2k03", "prerequisite_of", "电磁波形成机制之后，才能讨论其传播速度、介质和横波特征"),
        ("x2c4s2k03", "x2c4s2k04", "prerequisite_of", "电磁波传播特性是其携带能量和信息的基础"),
        ("x2c4s4k01", "x2c4s4k03", "applied_to", "电磁波谱整体认识用于解释不同波段的技术应用"),
        ("x2c4s4k03", "x2c4s4k04", "prerequisite_of", "了解各类电磁波应用后，需要进一步认识安全与防护边界"),
        ("x2c5s1k02", "x2c5s1k03", "prerequisite_of", "传感器系统组成决定输入量、敏感元件、输出量之间的对应关系"),
        ("x2c5s2k02", "x2c5s2k03", "confused_with", "热敏电阻和金属热电阻都与温度有关，但材料特性和阻值变化规律不同"),
        ("x2c5s2k04", "x2c5s2k07", "applied_to", "电容式传感器需要转化为可测电路量，最终落到传感器电路分析"),
        ("x2c5s2k05", "x2c5s2k06", "applied_to", "霍尔元件和干簧管都把磁场变化转化为电信号或开关状态"),
        ("x2c5s3k01", "x2c5s3k03", "prerequisite_of", "自动控制基本逻辑是理解比较器阈值控制的前提"),
        ("x2c5s2k07", "x2c5s3k04", "applied_to", "传感器实验设计需要把传感器元件接入可分析、可测量的电路"),

        # ── 选择性必修第三册：热学微观解释、物态性质、近代物理、粒子观 ──
        ("x3c2s1k03", "x3c2s1k04", "prerequisite_of", "热力学温标建立后，才能理解绝对零度的物理意义"),
        ("x3c2s4k01", "x3c2s4k02", "prerequisite_of", "区分晶体和非晶体后，再区分单晶体和多晶体"),
        ("x3c2s4k02", "x3c2s4k03", "prerequisite_of", "单晶体和多晶体的差异主要体现在各向异性和各向同性上"),
        ("x3c2s4k04", "x3c2s4k03", "prerequisite_of", "晶体微观结构决定宏观性质是否各向异性"),
        ("x3c2s5k01", "x3c2s5k02", "prerequisite_of", "液体表面张力和分子作用解释浸润与不浸润现象"),
        ("x3c2s5k02", "x3c2s5k03", "prerequisite_of", "毛细现象由浸润性和表面张力共同决定"),
        ("x3c2s4k03", "x3c2s5k04", "applied_to", "液晶兼具流动性和光学各向异性，是各向异性概念的应用"),
        ("x3c4s5k03", "x3c4s5k05", "prerequisite_of", "理解跃迁假设后，才能认识玻尔模型解释氢原子但不能解释复杂原子的范围"),
        ("x3c4s6k01", "x3c4s6k03", "prerequisite_of", "物质波思想引出微观粒子位置和动量不能同时无限精确确定的认识"),
        ("x3c4s6k03", "x3c4s6k04", "prerequisite_of", "不确定性关系是量子力学区别于经典力学的重要思想基础"),
        ("x3c5s5k01", "x3c5s5k02", "prerequisite_of", "粒子分类之后，再认识强子由夸克组成的模型"),
        ("x3c5s5k01", "x3c5s5k03", "prerequisite_of", "粒子分类需要进一步用四种基本相互作用理解粒子间作用"),
        ("x3c5s5k02", "x3c5s5k04", "prerequisite_of", "夸克模型是标准模型描述强子结构的重要组成"),
        ("x3c5s5k03", "x3c5s5k04", "prerequisite_of", "四种基本相互作用是标准模型定性认识的基础"),
    ]

    # =========================================================================
    # Assemble all relations
    # =========================================================================
    all_rels = []
    for src, tgt, rtype, reason in (v2_all + v3_all + x1_all + x2_all + x3_all + teacher_supplement):
        all_rels.append({
            "source_id": src,
            "target_id": tgt,
            "relation_type": rtype,
            "reason": reason,
        })
    return all_rels


def main():
    # Load existing
    existing_kps_path = SEED_DIR / "knowledge_points.json"
    existing_rels_path = SEED_DIR / "relations.json"

    with open(existing_kps_path) as f:
        kps = json.load(f)
    kp_ids = {kp["id"] for kp in kps}

    with open(existing_rels_path) as f:
        existing_rels = json.load(f)

    # Generate new relations
    new_rels = define_relations()

    # Validate KP IDs — skip unknown if --skip-missing flag passed
    skip_missing = "--skip-missing" in sys.argv
    missing = set()
    for r in new_rels:
        if r["source_id"] not in kp_ids:
            missing.add(r["source_id"])
        if r["target_id"] not in kp_ids:
            missing.add(r["target_id"])
    if missing:
        if not skip_missing:
            print(f"ERROR: {len(missing)} unknown KP IDs (use --skip-missing to ignore):")
            for mid in sorted(missing)[:20]:
                print(f"  {mid}")
            return 1
        print(f"WARNING: skipping {len(missing)} unknown KP IDs")
        new_rels = [r for r in new_rels if r["source_id"] in kp_ids and r["target_id"] in kp_ids]
        if not new_rels:
            print("No valid relations remain after skipping.")
            return 0

    # Deduplicate against existing
    existing_keys = {(r["source_id"], r["target_id"], r["relation_type"]) for r in existing_rels}
    added = 0
    skipped = 0
    for r in new_rels:
        key = (r["source_id"], r["target_id"], r["relation_type"])
        if key not in existing_keys:
            existing_rels.append(r)
            existing_keys.add(key)
            added += 1
        else:
            skipped += 1

    # Stats
    from collections import Counter
    types = Counter(r["relation_type"] for r in new_rels)
    print(f"Generated {len(new_rels)} new relations:")
    for t, c in types.most_common():
        print(f"  {t}: {c}")
    print(f"\nMerged: {added} added, {skipped} skipped (already exist)")
    print(f"Total relations: {len(existing_rels)}")

    # Save compactly: one relation per line, matching the existing seed style.
    with open(existing_rels_path, "w", encoding="utf-8") as f:
        f.write("[\n")
        for index, rel in enumerate(existing_rels):
            suffix = "," if index < len(existing_rels) - 1 else ""
            f.write(f"  {json.dumps(rel, ensure_ascii=False)}{suffix}\n")
        f.write("]\n")
    print(f"Wrote → {existing_rels_path}")

    return 0


if __name__ == "__main__":
    sys.exit(main())
