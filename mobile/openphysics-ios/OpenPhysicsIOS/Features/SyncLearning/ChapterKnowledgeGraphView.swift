import SwiftUI
import UIKit

struct ChapterKnowledgeGraphView: View {
    let knowledgePoints: [SyncKnowledgePoint]
    let relations: [SyncDirectoryRelation]
    let recommendedKnowledgePointId: String?
    let selectedKnowledgePointId: String?
    let onSelect: (SyncKnowledgePoint) -> Void

    private var layout: ChapterGraphLayout {
        ChapterGraphLayout.build(
            knowledgePoints: knowledgePoints,
            relations: relations
        )
    }

    @State private var viewportWidth: CGFloat = 0

    /// The point scrolled into view: the one the student tapped, else the recommendation.
    private var focusId: String? { selectedKnowledgePointId ?? recommendedKnowledgePointId }

    var body: some View {
        let layout = layout
        let focusNode = layout.nodes.first { $0.id == focusId }
        ScrollView([.horizontal, .vertical]) {
                ZStack(alignment: .topLeading) {
                    relationCanvas(layout)
                    ForEach(layout.nodes) { node in
                        ChapterGraphNodeView(
                            point: node.knowledgePoint,
                            recommended: node.knowledgePoint.id == recommendedKnowledgePointId,
                            selected: node.knowledgePoint.id == selectedKnowledgePointId,
                            onSelect: onSelect
                        )
                        .frame(
                            width: ChapterGraphSpec.nodeWidth,
                            height: ChapterGraphSpec.nodeViewHeight
                        )
                        .offset(x: node.x, y: node.y)
                    }
                    // Brings the focused point into view: SwiftUI scrollTo does not move this two-axis board.
                    if let focusNode {
                        ScrollFocusAnchor(token: focusNode.id)
                            .frame(width: ChapterGraphSpec.nodeWidth, height: ChapterGraphSpec.nodeViewHeight)
                            .padding(.leading, max(0, focusNode.x))
                            .padding(.top, max(0, focusNode.y))
                            .allowsHitTesting(false)
                    }
                    ForEach(layout.sections) { marker in
                        Text(marker.title)
                            .font(.caption.weight(.bold))
                            .foregroundStyle(OpenPhysicsTheme.accent)
                            .lineLimit(1)
                            .truncationMode(.tail)
                            .frame(width: marker.width - 20)
                            .padding(.horizontal, 10)
                            .padding(.vertical, 5)
                            .background(OpenPhysicsTheme.accentSoft)
                            .clipShape(Capsule())
                            .position(x: marker.centerX, y: 18)
                            .allowsHitTesting(false)
                    }
                }
                .frame(
                    width: layout.width,
                    height: max(layout.height, ChapterGraphSpec.minimumBoardHeight),
                    alignment: .topLeading
                )
                .padding(.horizontal, 22)
                .padding(.top, 14)
                .padding(.bottom, 28)
            }
            .scrollIndicators(.visible)
            .background(OpenPhysicsTheme.accentSoft.opacity(0.32))
            .overlay(alignment: .trailing) {
                // More columns to the right: fade the edge so cut-off nodes read as "scroll for more".
                if layout.width + 44 > viewportWidth + 1 {
                    ZStack {
                        Color(uiColor: .secondarySystemGroupedBackground)
                        OpenPhysicsTheme.accentSoft.opacity(0.32)
                    }
                    .mask(LinearGradient(colors: [.clear, .black], startPoint: .leading, endPoint: .trailing))
                    .frame(width: 44)
                    .allowsHitTesting(false)
                }
            }
            .background(
                GeometryReader { proxy in
                    Color.clear
                        .onAppear { viewportWidth = proxy.size.width }
                        .onChange(of: proxy.size.width) { viewportWidth = $0 }
                }
            )
            .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
    }

    /// Lines carry learning progress, as on Android: mastered→mastered recedes, mastered→not yet
    /// is the "ready to learn next" route, anything leaving an unmastered point is dashed. The
    /// focused point (the one tapped, else the recommendation) lifts its own lines above the rest.
    private func relationCanvas(_ layout: ChapterGraphLayout) -> some View {
        let mastered = Set(knowledgePoints.filter { $0.masteryLabel == "已掌握" }.map(\.id))
        let focus = focusId
        let styled = layout.edges
            .map { edge -> (edge: ChapterGraphEdge, kind: ChapterGraphEdgeKind, focused: Bool) in
                (edge, ChapterGraphLayout.edgeKind(edge, mastered: mastered),
                 focus != nil && (edge.from.id == focus || edge.to.id == focus))
            }
            .sorted { Self.drawOrder($0.kind, $0.focused) < Self.drawOrder($1.kind, $1.focused) }
        let related = layout.relatedEdges.filter { focus != nil && ($0.from.id == focus || $0.to.id == focus) }
        return Canvas { context, _ in
            for edge in related {
                let pathData = ChapterGraphLayout.path(from: edge.from, to: edge.to)
                context.stroke(
                    Self.curve(pathData),
                    with: .color(ChapterGraphEdgeColors.line.opacity(0.45)),
                    style: StrokeStyle(lineWidth: 2, lineCap: .round, dash: [1, 5])
                )
            }
            for item in styled {
                let pathData = ChapterGraphLayout.path(from: item.edge.from, to: item.edge.to)
                let style: (color: Color, opacity: Double, width: CGFloat)
                switch item.kind {
                case .done: style = (ChapterGraphEdgeColors.line, 0.16, 1.2)
                case .future: style = (ChapterGraphEdgeColors.line, 0.30, 1.4)
                case .frontier: style = (OpenPhysicsTheme.accent, 0.78, 2.2)
                }
                let base = style.color
                let baseOpacity = style.opacity
                let width = style.width
                let color: Color
                if item.focused {
                    color = item.kind == .frontier ? ChapterGraphEdgeColors.deep : ChapterGraphEdgeColors.line.opacity(0.75)
                } else {
                    color = base.opacity(focus != nil ? baseOpacity * 0.45 : baseOpacity)
                }
                context.stroke(
                    Self.curve(pathData),
                    with: .color(color),
                    style: StrokeStyle(
                        lineWidth: width + (item.focused ? 0.6 : 0),
                        lineCap: .round,
                        lineJoin: .round,
                        dash: item.kind == .future ? [5, 5] : []
                    )
                )
                var arrow = Path()
                arrow.move(to: pathData.end)
                arrow.addLine(to: pathData.arrowLeft)
                arrow.addLine(to: pathData.arrowRight)
                arrow.closeSubpath()
                context.fill(arrow, with: .color(color))
            }
        }
        .frame(width: layout.width, height: layout.height)
        .allowsHitTesting(false)
    }

    /// Faint lines first, the focused point's lines last (on top).
    private static func drawOrder(_ kind: ChapterGraphEdgeKind, _ focused: Bool) -> Int {
        (focused ? 10 : 0) + kind.rawValue
    }

    private static func curve(_ pathData: ChapterGraphPath) -> Path {
        var path = Path()
        path.move(to: pathData.start)
        path.addCurve(to: pathData.end, control1: pathData.controlA, control2: pathData.controlB)
        return path
    }
}

enum ChapterGraphEdgeKind: Int { case done, future, frontier }

enum ChapterGraphEdgeColors {
    static let line = Color(red: 0.28, green: 0.41, blue: 0.52)
    static let deep = Color(red: 0.03, green: 0.36, blue: 0.39)
}

/// Line legend shown beside the mastery colours: what the three line styles mean.
struct ChapterGraphEdgeLegend: View {
    /// "推荐路径" while the recommendation is focused, "所选知识点" once another point is tapped.
    let focusTitle: String?

    var body: some View {
        HStack(spacing: 12) {
            if let focusTitle { item(focusTitle, color: ChapterGraphEdgeColors.deep, width: 2.8) }
            item("可以接着学", color: OpenPhysicsTheme.accent, width: 2.2)
            item("前置未掌握", color: ChapterGraphEdgeColors.line.opacity(0.45), width: 1.4, dashed: true)
        }
    }

    private func item(_ title: String, color: Color, width: CGFloat, dashed: Bool = false) -> some View {
        HStack(spacing: 4) {
            Canvas { context, size in
                var line = Path()
                line.move(to: CGPoint(x: 0, y: size.height / 2))
                line.addLine(to: CGPoint(x: size.width, y: size.height / 2))
                context.stroke(line, with: .color(color),
                               style: StrokeStyle(lineWidth: width, lineCap: .round, dash: dashed ? [4, 3] : []))
            }
            .frame(width: 20, height: 8)
            Text(title).font(.caption2).foregroundStyle(.secondary)
        }
    }
}

private struct ChapterGraphNodeView: View {
    let point: SyncKnowledgePoint
    let recommended: Bool
    let selected: Bool
    let onSelect: (SyncKnowledgePoint) -> Void

    private var palette: ChapterGraphPalette {
        point.contentPending
            ? ChapterGraphPalette(fill: Color(uiColor: .systemGray6), border: Color(uiColor: .systemGray4), foreground: .secondary, dot: .gray)
            : ChapterGraphPalette.forMastery(point.masteryPercent)
    }

    /// Not started yet: a lighter circle, but the text keeps full contrast, and the recommended
    /// or selected point is never toned down.
    private var untouched: Bool { point.masteryPercent == 0 && !recommended && !selected }

    private var stateLabel: String {
        if recommended && point.judgment == nil { return "推荐" }
        return recommended && point.judgment?.confidence != "low" ? "推荐 · \(point.masteryLabel)" : point.masteryLabel
    }

    var body: some View {
        Button {
            onSelect(point)
        } label: {
            VStack(spacing: 5) {
                ZStack {
                    Circle()
                        .fill(untouched ? Color.white : palette.fill)
                    Circle()
                        .stroke(
                            selected ? OpenPhysicsTheme.accent : palette.border.opacity(untouched ? 0.55 : 1),
                            lineWidth: selected ? 3 : untouched ? 1.5 : 2
                        )
                    Text(point.contentPending ? "待补充" : "\(point.masteryPercent)%")
                        .font(.subheadline.bold())
                        .foregroundStyle(palette.foreground)
                }
                .frame(
                    width: ChapterGraphSpec.nodeDotSize,
                    height: ChapterGraphSpec.nodeDotSize
                )
                .shadow(
                    color: selected
                        ? OpenPhysicsTheme.accent.opacity(0.16)
                        : Color.black.opacity(0.055),
                    radius: selected ? 12 : 10,
                    y: 5
                )

                // Two lines like Android, so long names are not cut off.
                Text(point.name)
                    .font(.subheadline.weight(.bold))
                    .foregroundStyle(palette.foreground)
                    .lineLimit(2)
                    .multilineTextAlignment(.center)
                    .truncationMode(.tail)
                    .frame(maxWidth: ChapterGraphSpec.nodeWidth)

                HStack(spacing: 6) {
                    Circle()
                        .fill(palette.dot)
                        .frame(width: 7, height: 7)
                    Text(stateLabel)
                        .font(.caption.weight(.semibold))
                        .lineLimit(1)
                }
                .foregroundStyle(palette.foreground)
            }
            .frame(
                width: ChapterGraphSpec.nodeWidth,
                height: ChapterGraphSpec.nodeViewHeight,
                alignment: .top
            )
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(
            point.contentPending ? "\(point.name)，内容待补充" : "\(point.name)，\(stateLabel)，掌握度 \(point.masteryPercent)%"
        )
    }
}

/// Same grid as the Android tablet map (SyncTabletGraphSpec): three rows, points in textbook
/// order down each column, a small fixed jitter so the board does not read as a table.
enum ChapterGraphSpec {
    static let rows = 3
    static let nodeWidth: CGFloat = 148
    static let nodeHeight: CGFloat = 96
    static let nodeViewHeight: CGFloat = 130
    static let nodeDotSize: CGFloat = 62
    static let columnGap: CGFloat = 58
    static let rowGap: CGFloat = 88
    static let paddingX: CGFloat = 22
    static let paddingY: CGFloat = 46
    static let minimumBoardHeight: CGFloat = 620
    static let sectionMarkerWidth: CGFloat = 170

    static let offsets: [CGPoint] = [
        CGPoint(x: 0, y: 10),
        CGPoint(x: 16, y: -8),
        CGPoint(x: -12, y: 14),
        CGPoint(x: 18, y: 6),
        CGPoint(x: -8, y: -18),
        CGPoint(x: 12, y: 12),
        CGPoint(x: -16, y: 0),
        CGPoint(x: 8, y: -10),
    ]
}

struct ChapterGraphNode: Identifiable, Equatable {
    let knowledgePoint: SyncKnowledgePoint
    let index: Int
    let row: Int
    let column: Int
    let x: CGFloat
    let y: CGFloat

    var id: String { knowledgePoint.id }
    var center: CGPoint {
        CGPoint(
            x: x + ChapterGraphSpec.nodeWidth / 2,
            y: y + ChapterGraphSpec.nodeDotSize / 2
        )
    }
}

struct ChapterGraphSectionMarker: Identifiable, Equatable {
    let title: String
    let centerX: CGFloat
    var width: CGFloat = ChapterGraphSpec.sectionMarkerWidth

    var id: String { title }
}

struct ChapterGraphEdge: Identifiable, Equatable {
    let relationId: Int
    let from: ChapterGraphNode
    let to: ChapterGraphNode

    var id: String {
        "\(relationId)-\(from.knowledgePoint.id)-\(to.knowledgePoint.id)"
    }
}

struct ChapterGraphPath: Equatable {
    let start: CGPoint
    let end: CGPoint
    let controlA: CGPoint
    let controlB: CGPoint
    let arrowLeft: CGPoint
    let arrowRight: CGPoint
}

struct ChapterGraphLayout: Equatable {
    let width: CGFloat
    let height: CGFloat
    let sections: [ChapterGraphSectionMarker]
    let nodes: [ChapterGraphNode]
    /// Prerequisite arrows, with any arrow already implied by a longer chain removed.
    let edges: [ChapterGraphEdge]
    /// confused_with / applied_to / transfer: drawn only around the focused point.
    var relatedEdges: [ChapterGraphEdge] = []

    static let prerequisiteTypes: Set<String> = ["prerequisite_of", "prerequisite"]

    static func edgeKind(_ edge: ChapterGraphEdge, mastered: Set<String>) -> ChapterGraphEdgeKind {
        if !mastered.contains(edge.from.id) { return .future }
        return mastered.contains(edge.to.id) ? .done : .frontier
    }

    /// Drops an arrow A→C when A already reaches C through other arrows (A→B→C): the dependency
    /// is still shown, just once. Cycles are left as they are.
    static func transitivelyReduced(_ relations: [SyncDirectoryRelation]) -> [SyncDirectoryRelation] {
        var seenPairs: Set<[String]> = []
        let unique = relations.filter { seenPairs.insert([$0.sourceId, $0.targetId]).inserted }
        var next: [String: Set<String>] = [:]
        for relation in unique { next[relation.sourceId, default: []].insert(relation.targetId) }
        func reaches(_ from: String, _ to: String) -> Bool {
            var stack = [from]
            var seen: Set<String> = []
            while let node = stack.popLast() {
                if node == to { return true }
                guard seen.insert(node).inserted else { continue }
                stack.append(contentsOf: next[node, default: []])
            }
            return false
        }
        return unique.filter { relation in
            if reaches(relation.targetId, relation.sourceId) { return true }
            next[relation.sourceId]?.remove(relation.targetId)
            if reaches(relation.sourceId, relation.targetId) { return false }
            next[relation.sourceId, default: []].insert(relation.targetId)
            return true
        }
    }

    static func build(
        knowledgePoints: [SyncKnowledgePoint],
        relations: [SyncDirectoryRelation]
    ) -> ChapterGraphLayout {
        guard !knowledgePoints.isEmpty else {
            return ChapterGraphLayout(
                width: 0,
                height: 0,
                sections: [],
                nodes: [],
                edges: []
            )
        }

        let pitch = ChapterGraphSpec.nodeWidth + ChapterGraphSpec.columnGap
        let nodes = knowledgePoints.enumerated().map { index, point -> ChapterGraphNode in
            let column = index / ChapterGraphSpec.rows
            let row = index % ChapterGraphSpec.rows
            let offset = ChapterGraphSpec.offsets[index % ChapterGraphSpec.offsets.count]
            return ChapterGraphNode(
                knowledgePoint: point,
                index: index,
                row: row,
                column: column,
                x: ChapterGraphSpec.paddingX + CGFloat(column) * pitch + offset.x,
                y: ChapterGraphSpec.paddingY
                    + CGFloat(row) * (ChapterGraphSpec.nodeHeight + ChapterGraphSpec.rowGap)
                    + offset.y
            )
        }
        // Each section's title sits over the first point of that section.
        var seenSections: Set<String> = []
        let sections = nodes.compactMap { node -> ChapterGraphSectionMarker? in
            let title = node.knowledgePoint.section?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
            guard !title.isEmpty, seenSections.insert(title).inserted else { return nil }
            return ChapterGraphSectionMarker(title: title, centerX: node.center.x, width: ChapterGraphSpec.sectionMarkerWidth)
        }

        let width = (nodes.map(\.x).max() ?? 0)
            + ChapterGraphSpec.nodeWidth
            + ChapterGraphSpec.paddingX
        let height = max(
            (nodes.map(\.y).max() ?? 0) + ChapterGraphSpec.nodeHeight + ChapterGraphSpec.paddingY,
            ChapterGraphSpec.minimumBoardHeight
        )
        let pointIds = Set(knowledgePoints.map(\.id))
        let scopedRelations = relations.filter {
            pointIds.contains($0.sourceId)
                && pointIds.contains($0.targetId)
                && $0.sourceId != $0.targetId
        }
        let prerequisites = scopedRelations.filter { prerequisiteTypes.contains($0.relationType) }
        let visibleRelations: [SyncDirectoryRelation]
        if !prerequisites.isEmpty {
            visibleRelations = transitivelyReduced(prerequisites)
        } else if scopedRelations.isEmpty {
            visibleRelations = fallbackRelations(for: knowledgePoints)
        } else {
            visibleRelations = []
        }
        var seenRelatedPairs: Set<String> = []
        let relatedRelations = scopedRelations.filter { relation in
            guard !prerequisiteTypes.contains(relation.relationType) else { return false }
            let pair = [relation.sourceId, relation.targetId].sorted().joined(separator: "|")
            return seenRelatedPairs.insert(pair).inserted
        }
        let nodeById = Dictionary(uniqueKeysWithValues: nodes.map { ($0.id, $0) })
        let edges = visibleRelations.compactMap { relation -> ChapterGraphEdge? in
            guard
                let source = nodeById[relation.sourceId],
                let target = nodeById[relation.targetId]
            else { return nil }
            return ChapterGraphEdge(
                relationId: relation.id,
                from: source,
                to: target
            )
        }

        let relatedEdges = relatedRelations.compactMap { relation -> ChapterGraphEdge? in
            guard
                let source = nodeById[relation.sourceId],
                let target = nodeById[relation.targetId]
            else { return nil }
            return ChapterGraphEdge(relationId: relation.id, from: source, to: target)
        }

        return ChapterGraphLayout(
            width: width,
            height: height,
            sections: sections,
            nodes: nodes,
            edges: edges,
            relatedEdges: relatedEdges
        )
    }

    /// Links flow left to right as smooth S-curves, exactly as on the Android tablet.
    /// Each line leaves and enters a circle at its rim, so the arrowhead is never hidden.
    static func path(
        from: ChapterGraphNode,
        to: ChapterGraphNode
    ) -> ChapterGraphPath {
        let a = from.center
        let b = to.center
        let dx = b.x - a.x
        let dy = b.y - a.y
        let controlA: CGPoint
        let controlB: CGPoint
        if abs(dx) >= abs(dy) * 0.6 {
            controlA = CGPoint(x: a.x + dx * 0.5, y: a.y)
            controlB = CGPoint(x: b.x - dx * 0.5, y: b.y)
        } else {
            controlA = CGPoint(x: a.x, y: a.y + dy * 0.5)
            controlB = CGPoint(x: b.x, y: b.y - dy * 0.5)
        }
        let radius = ChapterGraphSpec.nodeDotSize / 2 + 3
        func rim(_ center: CGPoint, toward point: CGPoint) -> CGPoint {
            let vx = point.x - center.x
            let vy = point.y - center.y
            let length = (vx * vx + vy * vy).squareRoot()
            guard length >= 1 else { return center }
            return CGPoint(x: center.x + vx / length * radius, y: center.y + vy / length * radius)
        }
        let start = rim(a, toward: controlA)
        let end = rim(b, toward: controlB)

        let angle = atan2(end.y - controlB.y, end.x - controlB.x)
        let arrowSize: CGFloat = 8
        let spread: CGFloat = 0.55
        let arrowLeft = CGPoint(
            x: end.x - cos(angle - spread) * arrowSize,
            y: end.y - sin(angle - spread) * arrowSize
        )
        let arrowRight = CGPoint(
            x: end.x - cos(angle + spread) * arrowSize,
            y: end.y - sin(angle + spread) * arrowSize
        )

        return ChapterGraphPath(
            start: start,
            end: end,
            controlA: controlA,
            controlB: controlB,
            arrowLeft: arrowLeft,
            arrowRight: arrowRight
        )
    }

    private static func fallbackRelations(
        for points: [SyncKnowledgePoint]
    ) -> [SyncDirectoryRelation] {
        var dependencies: [String: [String]] = [:]

        for index in points.indices.dropFirst() {
            dependencies[points[index].id] = [points[index - 1].id]
        }

        func firstPoint(matching keywords: [String]) -> SyncKnowledgePoint? {
            points.first { point in
                let normalizedName = normalized(point.name)
                return keywords.contains {
                    normalizedName.contains(normalized($0))
                }
            }
        }

        func addDependency(
            target: SyncKnowledgePoint?,
            source: SyncKnowledgePoint?
        ) {
            guard
                let target,
                let source,
                target.id != source.id
            else { return }
            var sources = dependencies[target.id, default: []]
            if !sources.contains(source.id) {
                sources.append(source.id)
                dependencies[target.id] = sources
            }
        }

        let particle = firstPoint(matching: ["质点"])
        let reference = firstPoint(matching: ["参考系"])
        let coordinate = firstPoint(matching: ["坐标系"])
        let time = firstPoint(matching: ["时刻", "时间间隔"])
        let displacement = firstPoint(matching: ["位移"])
        let velocity = firstPoint(matching: ["速度"])
        let acceleration = firstPoint(matching: ["加速度"])
        let velocityTimeGraph = firstPoint(matching: ["v-t", "v－t", "v–t"])
        let positionTimeGraph = firstPoint(matching: ["x-t", "x－t", "x–t"])

        addDependency(target: reference, source: particle)
        addDependency(target: coordinate, source: reference)
        addDependency(target: displacement, source: coordinate)
        addDependency(target: velocity, source: displacement)
        addDependency(target: velocity, source: time)
        addDependency(target: acceleration, source: velocity)
        addDependency(target: velocityTimeGraph, source: velocity)
        addDependency(target: velocityTimeGraph, source: acceleration)
        addDependency(target: positionTimeGraph, source: displacement)
        addDependency(target: positionTimeGraph, source: time)

        return points.enumerated().flatMap { index, point in
            dependencies[point.id, default: []].enumerated().map {
                dependencyIndex,
                sourceId in
                SyncDirectoryRelation(
                    id: -(index * 100 + dependencyIndex + 1),
                    sourceId: sourceId,
                    targetId: point.id,
                    relationType: "fallback_prerequisite",
                    reason: nil
                )
            }
        }
    }

    private static func normalized(_ value: String) -> String {
        value
            .components(separatedBy: .whitespacesAndNewlines)
            .joined()
            .lowercased()
    }
}

enum MasteryColorBand: String, CaseIterable {
    case weak, developing, stable, mastered
    static func forPercent(_ percent: Int) -> MasteryColorBand {
        if percent < 40 { return .weak }
        if percent < 70 { return .developing }
        // 80% is the backend's single "已掌握" threshold.
        if percent < 80 { return .stable }
        return .mastered
    }
    var label: String {
        switch self {
        case .weak: return "0–39%"
        case .developing: return "40–69%"
        case .stable: return "70–79%"
        case .mastered: return "80–100%"
        }
    }
    var colors: (UInt, UInt, UInt) {
        switch self {
        case .weak: return (0xfff1dc, 0xf2a746, 0x9a4d08)
        case .developing: return (0xe8f0ff, 0x70a5ef, 0x245bb5)
        case .stable: return (0xdcf5f2, 0x45b4aa, 0x0f766e)
        case .mastered: return (0xe2f6d6, 0x76bf4e, 0x397b20)
        }
    }
}

struct MasteryColorLegend: View {
    var body: some View {
        HStack(spacing: 12) {
            ForEach(MasteryColorBand.allCases, id: \.self) { band in
                HStack(spacing: 4) {
                    Circle().fill(ChapterGraphPalette.color(band.colors.1)).frame(width: 8, height: 8)
                    Text(band.label).font(.caption2).foregroundStyle(.secondary)
                }
            }
        }.accessibilityLabel("掌握度分段：0至39橙色，40至69蓝色，70至84青色，85至100绿色")
    }
}

private struct ChapterGraphPalette {
    let fill: Color
    let border: Color
    let foreground: Color
    let dot: Color
    static func color(_ hex: UInt) -> Color {
        Color(red: Double((hex >> 16) & 255) / 255, green: Double((hex >> 8) & 255) / 255, blue: Double(hex & 255) / 255)
    }
    static func forMastery(_ percent: Int) -> ChapterGraphPalette {
        let colors = MasteryColorBand.forPercent(percent).colors
        return ChapterGraphPalette(fill: color(colors.0), border: color(colors.1), foreground: color(colors.2), dot: color(colors.1))
    }
}

/// Scrolls the enclosing scroll view horizontally so this anchor sits in the middle,
/// once per new token (first appearance and each change of focus).
private struct ScrollFocusAnchor: UIViewRepresentable {
    let token: String

    func makeUIView(context: Context) -> UIView {
        let view = UIView()
        view.isUserInteractionEnabled = false
        return view
    }

    func updateUIView(_ view: UIView, context: Context) {
        guard context.coordinator.lastToken != token else { return }
        context.coordinator.lastToken = token
        let animated = context.coordinator.hasScrolled
        context.coordinator.hasScrolled = true
        // After layout, when the scroll view knows its content size.
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.15) {
            var ancestor = view.superview
            while let current = ancestor, !(current is UIScrollView) { ancestor = current.superview }
            guard let scrollView = ancestor as? UIScrollView, scrollView.bounds.width > 0 else { return }
            let frame = view.convert(view.bounds, to: scrollView)
            let maxX = max(0, scrollView.contentSize.width - scrollView.bounds.width)
            let x = min(maxX, max(0, frame.midX - scrollView.bounds.width / 2))
            scrollView.setContentOffset(CGPoint(x: x, y: scrollView.contentOffset.y), animated: animated)
        }
    }

    func makeCoordinator() -> Coordinator { Coordinator() }

    final class Coordinator {
        var lastToken: String?
        var hasScrolled = false
    }
}
