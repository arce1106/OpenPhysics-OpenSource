import PencilKit
import SwiftUI
import UIKit

struct PencilCanvasView: UIViewRepresentable {
    @Binding var drawing: PKDrawing
    let allowsFingerDrawing: Bool
    let backgroundImageURL: URL?
    let onCanvasSizeChange: (CGSize) -> Void
    let onDrawingChange: (PKDrawing) -> Void
    var showsTools = true
    var backgroundPlacement = QuestionDrawingBackgroundPlacement()
    var onBackgroundPlacementChange: (QuestionDrawingBackgroundPlacement) -> Void = { _ in }

    func makeCoordinator() -> Coordinator {
        Coordinator(
            drawing: $drawing,
            onCanvasSizeChange: onCanvasSizeChange,
            onDrawingChange: onDrawingChange
        )
    }

    func makeUIView(context: Context) -> PencilCanvasContainerView {
        let container = PencilCanvasContainerView()
        let canvas = container.canvasView
        canvas.delegate = context.coordinator
        canvas.backgroundColor = .clear
        canvas.isOpaque = false
        canvas.drawing = drawing
        canvas.tool = PKInkingTool(.pen, color: .label, width: 4)
        canvas.drawingPolicy = allowsFingerDrawing ? .anyInput : .pencilOnly
        canvas.minimumZoomScale = 1
        canvas.maximumZoomScale = 1
        canvas.bouncesZoom = false
        container.onSizeChange = context.coordinator.onCanvasSizeChange
        container.setBackgroundImageURL(backgroundImageURL)
        container.allowsFingerDrawing = allowsFingerDrawing
        container.setPlacement(backgroundPlacement)
        container.onPlacementChange = onBackgroundPlacementChange
        context.coordinator.toolPicker.addObserver(canvas)
        context.coordinator.lastShowsTools = showsTools
        context.coordinator.toolPicker.setVisible(showsTools, forFirstResponder: canvas)
        DispatchQueue.main.async {
            canvas.becomeFirstResponder()
        }
        return container
    }

    func updateUIView(_ container: PencilCanvasContainerView, context: Context) {
        let canvas = container.canvasView
        context.coordinator.drawing = $drawing
        context.coordinator.onCanvasSizeChange = onCanvasSizeChange
        context.coordinator.onDrawingChange = onDrawingChange
        container.onSizeChange = onCanvasSizeChange
        container.setBackgroundImageURL(backgroundImageURL)
        container.allowsFingerDrawing = allowsFingerDrawing
        container.setPlacement(backgroundPlacement)
        container.onPlacementChange = onBackgroundPlacementChange
        canvas.drawingPolicy = allowsFingerDrawing ? .anyInput : .pencilOnly
        if context.coordinator.lastShowsTools != showsTools {
            context.coordinator.lastShowsTools = showsTools
            context.coordinator.toolPicker.setVisible(showsTools, forFirstResponder: canvas)
            if showsTools && !canvas.isFirstResponder { canvas.becomeFirstResponder() }
        }
        if canvas.drawing != drawing {
            canvas.drawing = drawing
        }
    }

    static func dismantleUIView(
        _ container: PencilCanvasContainerView,
        coordinator: Coordinator
    ) {
        container.cancelImageLoad()
        coordinator.toolPicker.setVisible(false, forFirstResponder: container.canvasView)
        coordinator.toolPicker.removeObserver(container.canvasView)
    }

    final class Coordinator: NSObject, PKCanvasViewDelegate {
        var drawing: Binding<PKDrawing>
        var onCanvasSizeChange: (CGSize) -> Void
        var onDrawingChange: (PKDrawing) -> Void
        let toolPicker = PKToolPicker()
        var lastShowsTools = true

        init(
            drawing: Binding<PKDrawing>,
            onCanvasSizeChange: @escaping (CGSize) -> Void,
            onDrawingChange: @escaping (PKDrawing) -> Void
        ) {
            self.drawing = drawing
            self.onCanvasSizeChange = onCanvasSizeChange
            self.onDrawingChange = onDrawingChange
        }

        func canvasViewDrawingDidChange(_ canvasView: PKCanvasView) {
            drawing.wrappedValue = canvasView.drawing
            onDrawingChange(canvasView.drawing)
        }
    }
}

final class PencilCanvasContainerView: UIView, UIGestureRecognizerDelegate {
    let canvasView = PKCanvasView()
    private let backgroundImageView = UIImageView()
    private var placement = QuestionDrawingBackgroundPlacement()
    private var gestureStart: QuestionDrawingBackgroundPlacement?
    private lazy var pinch = UIPinchGestureRecognizer(target: self, action: #selector(handlePinch(_:)))
    private lazy var twoFingerPan = makePan(touches: 2)
    private lazy var oneFingerPan = makePan(touches: 1)
    /// With finger drawing on, one finger draws; the image then moves with two fingers only.
    var allowsFingerDrawing = false
    var onPlacementChange: (QuestionDrawingBackgroundPlacement) -> Void = { _ in }
    private let loadingView = UIActivityIndicatorView(style: .medium)
    private var imageTask: URLSessionDataTask?
    private var representedURL: URL?
    private var lastReportedSize = CGSize.zero

    var onSizeChange: (CGSize) -> Void = { _ in }

    override init(frame: CGRect) {
        super.init(frame: frame)
        backgroundColor = .white
        clipsToBounds = true

        backgroundImageView.contentMode = .scaleToFill
        backgroundImageView.isHidden = true
        backgroundImageView.isUserInteractionEnabled = false
        addSubview(backgroundImageView)

        canvasView.translatesAutoresizingMaskIntoConstraints = false
        addSubview(canvasView)
        NSLayoutConstraint.activate([
            canvasView.leadingAnchor.constraint(equalTo: leadingAnchor),
            canvasView.trailingAnchor.constraint(equalTo: trailingAnchor),
            canvasView.topAnchor.constraint(equalTo: topAnchor),
            canvasView.bottomAnchor.constraint(equalTo: bottomAnchor),
        ])

        // On the container, so they see touches that land on the canvas above the image.
        for recognizer in [pinch, twoFingerPan, oneFingerPan] as [UIGestureRecognizer] {
            recognizer.delegate = self
            recognizer.cancelsTouchesInView = false
            addGestureRecognizer(recognizer)
        }

        loadingView.hidesWhenStopped = true
        loadingView.translatesAutoresizingMaskIntoConstraints = false
        addSubview(loadingView)
        NSLayoutConstraint.activate([
            loadingView.centerXAnchor.constraint(equalTo: centerXAnchor),
            loadingView.centerYAnchor.constraint(equalTo: centerYAnchor),
        ])
    }

    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }

    override func layoutSubviews() {
        super.layoutSubviews()
        if let image = backgroundImageView.image {
            backgroundImageView.frame = QuestionDrawingBackgroundLayout.rect(
                sourceSize: image.size,
                canvasSize: bounds.size,
                placement: placement
            )
        }
        guard bounds.size != lastReportedSize, bounds.width > 0, bounds.height > 0 else {
            return
        }
        lastReportedSize = bounds.size
        onSizeChange(bounds.size)
    }

    func setBackgroundImageURL(_ url: URL?) {
        guard representedURL != url else { return }
        cancelImageLoad()
        representedURL = url
        backgroundImageView.image = nil
        backgroundImageView.isHidden = true
        setNeedsLayout()

        guard let url else { return }
        loadingView.startAnimating()
        imageTask = URLSession.shared.dataTask(with: url) { [weak self] data, _, _ in
            let image = data.flatMap(UIImage.init(data:))
            DispatchQueue.main.async {
                guard let self, self.representedURL == url else { return }
                self.loadingView.stopAnimating()
                self.backgroundImageView.image = image
                self.backgroundImageView.isHidden = image == nil
                self.setNeedsLayout()
            }
        }
        imageTask?.resume()
    }

    func setPlacement(_ next: QuestionDrawingBackgroundPlacement) {
        // A gesture in progress owns the placement until it ends.
        guard gestureStart == nil, next != placement else { return }
        placement = next
        setNeedsLayout()
    }

    private func makePan(touches: Int) -> UIPanGestureRecognizer {
        let pan = UIPanGestureRecognizer(target: self, action: #selector(handlePan(_:)))
        pan.minimumNumberOfTouches = touches
        pan.maximumNumberOfTouches = touches
        pan.allowedTouchTypes = [NSNumber(value: UITouch.TouchType.direct.rawValue)]
        return pan
    }

    override func gestureRecognizerShouldBegin(_ recognizer: UIGestureRecognizer) -> Bool {
        guard backgroundImageView.image != nil, !backgroundImageView.isHidden else { return false }
        if recognizer === oneFingerPan {
            // One finger moves the image only when it is not drawing and starts on the image.
            return !allowsFingerDrawing && backgroundImageView.frame.contains(recognizer.location(in: self))
        }
        return super.gestureRecognizerShouldBegin(recognizer)
    }

    func gestureRecognizer(
        _ recognizer: UIGestureRecognizer,
        shouldRecognizeSimultaneouslyWith other: UIGestureRecognizer
    ) -> Bool {
        let own: [UIGestureRecognizer] = [pinch, twoFingerPan]
        return own.contains(where: { $0 === recognizer }) && own.contains(where: { $0 === other })
    }

    @objc private func handlePinch(_ recognizer: UIPinchGestureRecognizer) { track(recognizer) }

    @objc private func handlePan(_ recognizer: UIPanGestureRecognizer) { track(recognizer) }

    private var imageGestures: [UIGestureRecognizer] { [pinch, twoFingerPan, oneFingerPan] }

    private func isActive(_ recognizer: UIGestureRecognizer) -> Bool {
        recognizer.state == .began || recognizer.state == .changed
    }

    private func track(_ recognizer: UIGestureRecognizer) {
        switch recognizer.state {
        case .began:
            if gestureStart == nil { gestureStart = placement }
            rebaseActiveGestures()
        case .changed:
            applyActiveGestures()
        case .ended, .cancelled, .failed:
            if imageGestures.contains(where: { $0 !== recognizer && isActive($0) }) {
                // Another gesture continues: keep what this one did and measure from here.
                rebaseActiveGestures()
            } else if gestureStart != nil {
                gestureStart = nil
                onPlacementChange(placement)
            }
        default:
            break
        }
    }

    /// Pinch zoom and drag combine from one starting placement.
    private func applyActiveGestures() {
        guard let start = gestureStart else { return }
        var next = start
        if isActive(pinch) {
            next.zoom = QuestionDrawingBackgroundPlacement.clampedZoom(start.zoom * pinch.scale)
        }
        for pan in [twoFingerPan, oneFingerPan] where isActive(pan) {
            let moved = pan.translation(in: self)
            next.offset = CGSize(
                width: start.offset.width + moved.x / max(bounds.width, 1),
                height: start.offset.height + moved.y / max(bounds.height, 1)
            )
        }
        placement = next
        setNeedsLayout()
    }

    private func rebaseActiveGestures() {
        gestureStart = placement
        pinch.scale = 1
        twoFingerPan.setTranslation(.zero, in: self)
        oneFingerPan.setTranslation(.zero, in: self)
    }

    func cancelImageLoad() {
        imageTask?.cancel()
        imageTask = nil
        loadingView.stopAnimating()
    }
}

/// Where the student moved and scaled the question image on the draft paper, relative to its
/// default spot: `offset` is a fraction of the canvas size, `zoom` multiplies the default size.
struct QuestionDrawingBackgroundPlacement: Equatable {
    var offset: CGSize = .zero
    var zoom: CGFloat = 1

    static let zoomRange: ClosedRange<CGFloat> = 0.5...4

    static func clampedZoom(_ value: CGFloat) -> CGFloat {
        min(max(value, zoomRange.lowerBound), zoomRange.upperBound)
    }
}

enum QuestionDrawingBackgroundLayout {
    /// At least this much of the image stays on the paper, so it can always be dragged back.
    static let minimumVisible: CGFloat = 48

    static func rect(
        sourceSize: CGSize,
        canvasSize: CGSize,
        placement: QuestionDrawingBackgroundPlacement
    ) -> CGRect {
        let base = rect(sourceSize: sourceSize, canvasSize: canvasSize)
        guard base.width > 0, base.height > 0 else { return base }
        let zoom = QuestionDrawingBackgroundPlacement.clampedZoom(placement.zoom)
        let size = CGSize(width: base.width * zoom, height: base.height * zoom)
        var x = base.midX - size.width / 2 + placement.offset.width * canvasSize.width
        var y = base.midY - size.height / 2 + placement.offset.height * canvasSize.height
        let keep = min(minimumVisible, size.width, size.height)
        x = min(max(x, keep - size.width), canvasSize.width - keep)
        y = min(max(y, keep - size.height), canvasSize.height - keep)
        return CGRect(origin: CGPoint(x: x, y: y), size: size)
    }

    static func rect(sourceSize: CGSize, canvasSize: CGSize) -> CGRect {
        guard
            sourceSize.width > 0,
            sourceSize.height > 0,
            canvasSize.width > 0,
            canvasSize.height > 0
        else {
            return CGRect(x: 16, y: 16, width: 0, height: 0)
        }
        let scale = min(
            canvasSize.width * 0.42 / sourceSize.width,
            canvasSize.height * 0.36 / sourceSize.height,
            0.42
        )
        return CGRect(
            x: 16,
            y: 16,
            width: sourceSize.width * scale,
            height: sourceSize.height * scale
        )
    }
}
