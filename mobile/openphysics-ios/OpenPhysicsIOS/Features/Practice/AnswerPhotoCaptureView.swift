import AVFoundation
import PhotosUI
import SwiftUI
import UIKit

struct AnswerPhotoContext: Identifiable {
    let id = UUID()
    let attemptId: UUID
    let questionId: String
    let studentToken: String
}

/// A candidate is deliberately kept out of the saved answer until the student confirms it.
@MainActor
final class AnswerPhotoSelection: ObservableObject {
    @Published private(set) var data: Data?
    @Published private(set) var image: UIImage?
    @Published private(set) var isEdited = false
    @Published var message = ""
    private var originalData: Data?

    func preview(_ data: Data) {
        guard let source = UIImage(data: data) else {
            message = "无法读取这张照片，请重新拍摄或选择。"
            return
        }
        // A 12-megapixel original is more than grading needs; shrink it once so editing stays quick.
        var image = source
        var data = data
        if let compact = AnswerPhotoEditor.compacted(source), let encoded = compact.jpegData(compressionQuality: 0.9) {
            image = compact
            data = encoded
        }
        self.data = data
        self.image = image
        originalData = data
        isEdited = false
        message = ""
    }

    /// A quarter turn, for a sheet photographed sideways or upside down.
    func rotate(clockwise: Bool) {
        guard let image else { return }
        apply(AnswerPhotoEditor.rotated(image, clockwise: clockwise))
    }

    /// Keeps only the answer area; `normalizedRect` is in the displayed image, 0...1 on each axis.
    func crop(to normalizedRect: CGRect) {
        guard let image, let cropped = AnswerPhotoEditor.cropped(image, to: normalizedRect) else { return }
        apply(cropped)
    }

    func revert() {
        guard let originalData else { return }
        preview(originalData)
    }

    func cancel() {
        data = nil
        image = nil
        originalData = nil
        isEdited = false
        message = ""
    }

    private func apply(_ edited: UIImage) {
        guard let encoded = edited.jpegData(compressionQuality: 0.95) else {
            message = "照片暂时无法编辑，请重新拍摄或选择。"
            return
        }
        data = encoded
        image = edited
        isEdited = true
        message = ""
    }
}

/// Rotation and cropping on an upright copy, so the saved file has no orientation flag to misread.
enum AnswerPhotoEditor {
    static let workingMaxSide: CGFloat = 2_560

    /// A smaller upright copy when the photo is larger than editing and grading need; nil otherwise.
    static func compacted(_ image: UIImage) -> UIImage? {
        let pixels = CGSize(width: image.size.width * image.scale, height: image.size.height * image.scale)
        let longest = max(pixels.width, pixels.height)
        guard longest > workingMaxSide else { return nil }
        let ratio = workingMaxSide / longest
        let size = CGSize(width: (pixels.width * ratio).rounded(), height: (pixels.height * ratio).rounded())
        return render(size: size) { _ in image.draw(in: CGRect(origin: .zero, size: size)) }
    }

    static func upright(_ image: UIImage) -> UIImage {
        guard image.imageOrientation != .up else { return image }
        return render(size: image.size) { _ in image.draw(in: CGRect(origin: .zero, size: image.size)) }
    }

    static func rotated(_ image: UIImage, clockwise: Bool) -> UIImage {
        let source = upright(image)
        let size = CGSize(width: source.size.height, height: source.size.width)
        return render(size: size) { context in
            let cg = context.cgContext
            cg.translateBy(x: size.width / 2, y: size.height / 2)
            cg.rotate(by: clockwise ? .pi / 2 : -.pi / 2)
            source.draw(in: CGRect(
                x: -source.size.width / 2, y: -source.size.height / 2,
                width: source.size.width, height: source.size.height
            ))
        }
    }

    static func cropped(_ image: UIImage, to normalizedRect: CGRect) -> UIImage? {
        let source = upright(image)
        guard let cgImage = source.cgImage else { return nil }
        let unit = normalizedRect.intersection(CGRect(x: 0, y: 0, width: 1, height: 1))
        guard !unit.isNull, unit.width > 0, unit.height > 0 else { return nil }
        let pixels = CGRect(
            x: unit.minX * CGFloat(cgImage.width), y: unit.minY * CGFloat(cgImage.height),
            width: unit.width * CGFloat(cgImage.width), height: unit.height * CGFloat(cgImage.height)
        ).integral
        guard let cropped = cgImage.cropping(to: pixels) else { return nil }
        return UIImage(cgImage: cropped, scale: source.scale, orientation: .up)
    }

    private static func render(size: CGSize, _ draw: (UIGraphicsImageRendererContext) -> Void) -> UIImage {
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        format.opaque = true
        return UIGraphicsImageRenderer(size: size, format: format).image(actions: draw)
    }
}

struct AnswerPhotoCaptureView: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(\.openPhysicsIsPhone) private var isPhone
    @StateObject private var selection = AnswerPhotoSelection()
    @State private var libraryItem: PhotosPickerItem?
    @State private var showsCamera = false
    @State private var isReading = false
    @State private var isRequestingCamera = false
    @State private var permissionDenied = false
    @State private var showsCrop = false
    let onConfirm: (Data) -> String?

    @MainActor init(selection: AnswerPhotoSelection? = nil, onConfirm: @escaping (Data) -> String?) {
        _selection = StateObject(wrappedValue: selection ?? AnswerPhotoSelection())
        self.onConfirm = onConfirm
    }

    var body: some View {
        NavigationStack {
            Group {
                if let image = selection.image {
                    previewContent(image)
                } else {
                    captureContent
                }
            }
            .frame(maxWidth: isPhone ? .infinity : 620)
            .frame(maxWidth: .infinity)
            .padding(.horizontal, 20)
            .padding(.vertical, 16)
            .background(OpenPhysicsTheme.pageBackground)
            .navigationTitle(selection.image == nil ? "拍照上传" : "确认作答照片")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("取消") { selection.cancel(); dismiss() }
                }
            }
            .fullScreenCover(isPresented: $showsCrop) {
                if let image = selection.image {
                    AnswerPhotoCropView(image: image, onCancel: { showsCrop = false }) { rect in
                        selection.crop(to: rect)
                        showsCrop = false
                    }
                }
            }
            .fullScreenCover(isPresented: $showsCamera) {
                AnswerCameraView { image in
                    if let image, let data = image.jpegData(compressionQuality: 0.95) {
                        selection.preview(data)
                    }
                    showsCamera = false
                }.ignoresSafeArea()
            }
            .task(id: libraryItem) {
                guard let item = libraryItem else { return }
                isReading = true
                defer { if !Task.isCancelled { isReading = false } }
                do {
                    let data = try await item.loadTransferable(type: Data.self)
                    guard !Task.isCancelled else { return }
                    if let data { selection.preview(data) }
                    else { selection.message = "无法读取这张照片，请重新选择。" }
                } catch {
                    if !Task.isCancelled { selection.message = "无法读取这张照片，请重新选择。" }
                }
            }
        }
    }

    /// Before a photo: the camera itself is the main action, with the album just below it.
    private var captureContent: some View {
        VStack(spacing: 22) {
            Spacer(minLength: 0)
            Button {
                Task { await openCamera() }
            } label: {
                ZStack {
                    Circle()
                        .fill(OpenPhysicsTheme.accent.opacity(0.12))
                        .frame(width: 128, height: 128)
                    Circle()
                        .fill(OpenPhysicsTheme.accent)
                        .frame(width: 88, height: 88)
                        .shadow(color: OpenPhysicsTheme.accent.opacity(0.28), radius: 12, y: 6)
                    Image(systemName: "camera.fill")
                        .font(.system(size: 34, weight: .semibold))
                        .foregroundStyle(.white)
                }
            }
            .buttonStyle(.plain)
            .disabled(isReading || isRequestingCamera)
            .accessibilityLabel("拍照")
            .accessibilityIdentifier("answer-photo-camera")

            VStack(spacing: 6) {
                Text("拍摄作答照片").font(.title3.weight(.semibold))
                Text("对准做题区域拍清楚，拍好后可以旋转和裁剪。")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
            }

            PhotosPicker(selection: $libraryItem, matching: .images) {
                Label("从相册选择", systemImage: "photo.on.rectangle")
                    .font(.body.weight(.medium))
                    .padding(.horizontal, 22)
                    .frame(minHeight: 44)
            }
            .buttonStyle(.bordered)
            .buttonBorderShape(.capsule)
            .tint(OpenPhysicsTheme.accent)
            .disabled(isReading || isRequestingCamera)

            cameraSettingsButton
            if isReading { ProgressView("正在读取照片…") }
            if !selection.message.isEmpty {
                Text(selection.message)
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
            }
            Spacer(minLength: 0)
        }
        .frame(maxWidth: .infinity)
    }

    /// With a photo: the picture first, one compact tool bar, then a single primary action.
    private func previewContent(_ image: UIImage) -> some View {
        VStack(spacing: 14) {
            AnswerPhotoPreview(image: image)
                .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
                .accessibilityLabel("作答照片预览，可双指放大检查")
            editToolbar
            Text(selection.message.isEmpty ? "转正、裁到做题区域，双指可放大检查字迹。" : selection.message)
                .font(.footnote)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
                .fixedSize(horizontal: false, vertical: true)
            if isReading { ProgressView("正在读取照片…") }
            confirmButton
            HStack(spacing: 28) {
                Button {
                    Task { await openCamera() }
                } label: {
                    Label("重拍", systemImage: "camera")
                }
                .disabled(isReading || isRequestingCamera)
                PhotosPicker(selection: $libraryItem, matching: .images) {
                    Label("换一张", systemImage: "photo")
                }
                .disabled(isReading || isRequestingCamera)
            }
            .font(.subheadline.weight(.medium))
            .tint(OpenPhysicsTheme.accent)
            cameraSettingsButton
        }
    }

    private var editToolbar: some View {
        HStack(spacing: 0) {
            editTool("左转", symbol: "rotate.left") { selection.rotate(clockwise: false) }
            editTool("右转", symbol: "rotate.right") { selection.rotate(clockwise: true) }
            editTool("裁剪", symbol: "crop") { showsCrop = true }
            editTool("还原", symbol: "arrow.uturn.backward") { selection.revert() }
                .disabled(!selection.isEdited)
                .opacity(selection.isEdited ? 1 : 0.35)
        }
        .padding(.vertical, 6)
        .padding(.horizontal, 6)
        .background(Color(uiColor: .secondarySystemGroupedBackground), in: Capsule())
        .overlay(Capsule().stroke(Color(uiColor: .separator).opacity(0.35), lineWidth: 0.5))
        .disabled(isReading || isRequestingCamera)
    }

    private func editTool(_ title: String, symbol: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            VStack(spacing: 3) {
                Image(systemName: symbol).font(.system(size: 18, weight: .medium))
                Text(title).font(.caption2.weight(.medium))
            }
            .foregroundStyle(OpenPhysicsTheme.accent)
            .frame(maxWidth: .infinity, minHeight: 48)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(title)
    }

    @ViewBuilder private var cameraSettingsButton: some View {
        if permissionDenied {
            Button("打开相机设置") {
                if let url = URL(string: UIApplication.openSettingsURLString) {
                    UIApplication.shared.open(url)
                }
            }
            .font(.subheadline)
            .tint(OpenPhysicsTheme.accent)
        }
    }

    private var confirmButton: some View {
        Button {
            guard let data = selection.data else { return }
            if let error = onConfirm(data) {
                selection.message = error
            } else {
                selection.cancel()
                dismiss()
            }
        } label: {
            Text("使用这张照片")
                .font(.headline)
                .frame(maxWidth: .infinity, minHeight: 50)
        }
        .buttonStyle(.borderedProminent)
        .buttonBorderShape(.capsule)
        .tint(OpenPhysicsTheme.accent)
        .disabled(selection.data == nil || isReading || isRequestingCamera)
        .accessibilityIdentifier("answer-photo-confirm")
    }

    @MainActor private func openCamera() async {
        guard !isRequestingCamera else { return }
        guard UIImagePickerController.isSourceTypeAvailable(.camera) else {
            selection.message = "当前设备无法使用相机，可以从相册选择照片。"
            return
        }
        isRequestingCamera = true
        defer { isRequestingCamera = false }
        let status = AVCaptureDevice.authorizationStatus(for: .video)
        // Request permission only after the student's camera action.
        let granted = status == .notDetermined ? await AVCaptureDevice.requestAccess(for: .video) : status == .authorized
        guard !Task.isCancelled else { return }
        permissionDenied = !granted
        if granted { selection.message = ""; showsCamera = true }
        else { selection.message = "尚未允许使用相机。你可以在设置中开启，也可以从相册选择。" }
    }

}

/// Custom shutter controls avoid a second system confirmation; the next screen is our preview.
private struct AnswerCameraView: UIViewControllerRepresentable {
    let onCapture: (UIImage?) -> Void
    func makeCoordinator() -> Coordinator { Coordinator(onCapture: onCapture) }
    func makeUIViewController(context: Context) -> UIImagePickerController {
        let picker = UIImagePickerController()
        picker.sourceType = .camera
        picker.cameraCaptureMode = .photo
        picker.showsCameraControls = false
        picker.delegate = context.coordinator
        context.coordinator.picker = picker
        let overlay = UIView(frame: picker.view.bounds)
        overlay.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        let controls = UIStackView()
        controls.axis = .horizontal
        controls.alignment = .center
        controls.spacing = 44
        controls.translatesAutoresizingMaskIntoConstraints = false
        let cancel = UIButton(type: .system)
        cancel.setTitle("取消", for: .normal)
        cancel.tintColor = .white
        cancel.addTarget(context.coordinator, action: #selector(Coordinator.cancel), for: .touchUpInside)
        let shutter = UIButton(type: .system)
        shutter.setImage(UIImage(systemName: "circle.inset.filled", withConfiguration: UIImage.SymbolConfiguration(pointSize: 64)), for: .normal)
        shutter.tintColor = .white
        shutter.accessibilityLabel = "拍摄作答照片"
        shutter.addTarget(context.coordinator, action: #selector(Coordinator.capture), for: .touchUpInside)
        context.coordinator.shutter = shutter
        controls.addArrangedSubview(cancel)
        controls.addArrangedSubview(shutter)
        overlay.addSubview(controls)
        NSLayoutConstraint.activate([
            controls.centerXAnchor.constraint(equalTo: overlay.centerXAnchor),
            controls.bottomAnchor.constraint(equalTo: overlay.safeAreaLayoutGuide.bottomAnchor, constant: -24),
        ])
        picker.cameraOverlayView = overlay
        return picker
    }
    func updateUIViewController(_ controller: UIImagePickerController, context: Context) {}
    final class Coordinator: NSObject, UIImagePickerControllerDelegate, UINavigationControllerDelegate {
        let onCapture: (UIImage?) -> Void
        weak var picker: UIImagePickerController?
        weak var shutter: UIButton?
        init(onCapture: @escaping (UIImage?) -> Void) { self.onCapture = onCapture }
        @objc func capture() { shutter?.isEnabled = false; picker?.takePicture() }
        @objc func cancel() { onCapture(nil) }
        func imagePickerControllerDidCancel(_ picker: UIImagePickerController) { onCapture(nil) }
        func imagePickerController(_ picker: UIImagePickerController, didFinishPickingMediaWithInfo info: [UIImagePickerController.InfoKey: Any]) {
            onCapture(info[.originalImage] as? UIImage)
        }
    }
}

struct AnswerPhotoPreview: UIViewRepresentable {
    let image: UIImage
    func makeUIView(context: Context) -> PhotoZoomScrollView { PhotoZoomScrollView() }
    func updateUIView(_ view: PhotoZoomScrollView, context: Context) { view.show(image) }
}

final class PhotoZoomScrollView: UIScrollView, UIScrollViewDelegate {
    private let photo = UIImageView()
    private var viewportSize = CGSize.zero
    override init(frame: CGRect) {
        super.init(frame: frame)
        delegate = self
        minimumZoomScale = 1
        maximumZoomScale = 5
        photo.contentMode = .scaleAspectFit
        backgroundColor = .secondarySystemBackground
        addSubview(photo)
    }
    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }
    func show(_ image: UIImage) {
        guard photo.image !== image else { return }
        setZoomScale(1, animated: false)
        photo.image = image
        viewportSize = .zero
        setNeedsLayout()
    }
    override func layoutSubviews() {
        super.layoutSubviews()
        if bounds.size != viewportSize {
            setZoomScale(1, animated: false)
            viewportSize = bounds.size
            photo.frame = CGRect(origin: .zero, size: bounds.size)
            contentSize = bounds.size
        }
    }
    func viewForZooming(in scrollView: UIScrollView) -> UIView? { photo }
}

/// Drag any corner or edge (or the box itself) over the answer area; the result is in the image's 0...1 space.
struct AnswerPhotoCropView: View {
    let image: UIImage
    let onCancel: () -> Void
    let onDone: (CGRect) -> Void
    @State private var crop = AnswerPhotoCropView.initialCrop
    @State private var drag: (handle: Handle, start: CGRect)?

    static let initialCrop = CGRect(x: 0.06, y: 0.06, width: 0.88, height: 0.88)
    static let minimumSide: CGFloat = 0.12
    /// How close (in points) a touch must start to a corner or edge to grab it.
    static let grabDistance: CGFloat = 32

    /// Which sides a drag moves; all four set means moving the whole box.
    struct Handle: Equatable {
        var left = false, top = false, right = false, bottom = false
        static let move = Handle(left: true, top: true, right: true, bottom: true)
        var isMove: Bool { self == .move }
    }

    var body: some View {
        NavigationStack {
            GeometryReader { proxy in
                let frame = Self.fittedFrame(image.size, in: proxy.size)
                let box = Self.box(for: crop, in: frame)
                ZStack(alignment: .topLeading) {
                    Color.black
                    Image(uiImage: image)
                        .resizable()
                        .frame(width: frame.width, height: frame.height)
                        .position(x: frame.midX, y: frame.midY)
                    Path { path in path.addRect(frame); path.addRect(box) }
                        .fill(Color.black.opacity(0.55), style: FillStyle(eoFill: true))
                    cropOutline(box)
                }
                .contentShape(Rectangle())
                .gesture(cropGesture(frame: frame, box: box))
                .accessibilityElement()
                .accessibilityLabel("裁剪框，拖动四角或四边调整大小，拖动框内移动位置")
            }
            .padding(.bottom, 8)
            .background(Color.black)
            .navigationTitle("裁剪到做题区域")
            .navigationBarTitleDisplayMode(.inline)
            .toolbarBackground(.visible, for: .navigationBar)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("取消", action: onCancel) }
                ToolbarItem(placement: .confirmationAction) { Button("完成") { onDone(crop) }.fontWeight(.semibold) }
                ToolbarItem(placement: .bottomBar) {
                    Button("重置选框") { crop = Self.initialCrop }.disabled(crop == Self.initialCrop)
                }
            }
        }
    }

    /// A thin frame, L-shaped corner brackets and a short bar on each edge, all non-interactive.
    private func cropOutline(_ box: CGRect) -> some View {
        Canvas { context, _ in
            context.stroke(Path(box), with: .color(.white.opacity(0.9)), lineWidth: 1)
            let arm = min(22, box.width / 3, box.height / 3)
            var brackets = Path()
            for (x, y, dx, dy) in [(box.minX, box.minY, 1.0, 1.0), (box.maxX, box.minY, -1.0, 1.0),
                                   (box.minX, box.maxY, 1.0, -1.0), (box.maxX, box.maxY, -1.0, -1.0)] {
                brackets.move(to: CGPoint(x: x + dx * arm, y: y))
                brackets.addLine(to: CGPoint(x: x, y: y))
                brackets.addLine(to: CGPoint(x: x, y: y + dy * arm))
            }
            let bar = min(28, box.width / 4, box.height / 4)
            brackets.move(to: CGPoint(x: box.midX - bar / 2, y: box.minY)); brackets.addLine(to: CGPoint(x: box.midX + bar / 2, y: box.minY))
            brackets.move(to: CGPoint(x: box.midX - bar / 2, y: box.maxY)); brackets.addLine(to: CGPoint(x: box.midX + bar / 2, y: box.maxY))
            brackets.move(to: CGPoint(x: box.minX, y: box.midY - bar / 2)); brackets.addLine(to: CGPoint(x: box.minX, y: box.midY + bar / 2))
            brackets.move(to: CGPoint(x: box.maxX, y: box.midY - bar / 2)); brackets.addLine(to: CGPoint(x: box.maxX, y: box.midY + bar / 2))
            context.stroke(brackets, with: .color(.white), style: StrokeStyle(lineWidth: 4, lineCap: .round, lineJoin: .round))
        }
        .allowsHitTesting(false)
    }

    private func cropGesture(frame: CGRect, box: CGRect) -> some Gesture {
        DragGesture(minimumDistance: 0)
            .onChanged { value in
                if drag == nil {
                    guard let handle = Self.handle(at: value.startLocation, box: box) else { return }
                    drag = (handle, crop)
                }
                guard let drag else { return }
                crop = Self.adjusted(
                    drag.start, handle: drag.handle,
                    dx: value.translation.width / max(frame.width, 1),
                    dy: value.translation.height / max(frame.height, 1)
                )
            }
            .onEnded { _ in drag = nil }
    }

    static func box(for crop: CGRect, in frame: CGRect) -> CGRect {
        CGRect(x: frame.minX + crop.minX * frame.width, y: frame.minY + crop.minY * frame.height,
               width: crop.width * frame.width, height: crop.height * frame.height)
    }

    /// The corner or edge nearest to where the touch began, or the whole box from inside it.
    static func handle(at point: CGPoint, box: CGRect) -> Handle? {
        let reach = grabDistance
        let nearLeft = abs(point.x - box.minX) <= reach, nearRight = abs(point.x - box.maxX) <= reach
        let nearTop = abs(point.y - box.minY) <= reach, nearBottom = abs(point.y - box.maxY) <= reach
        let withinX = point.x >= box.minX - reach && point.x <= box.maxX + reach
        let withinY = point.y >= box.minY - reach && point.y <= box.maxY + reach
        var handle = Handle()
        if withinY {
            // On a narrow box both edges are in reach; take the closer one.
            if nearLeft && nearRight { handle.left = abs(point.x - box.minX) < abs(point.x - box.maxX); handle.right = !handle.left }
            else { handle.left = nearLeft; handle.right = nearRight }
        }
        if withinX {
            if nearTop && nearBottom { handle.top = abs(point.y - box.minY) < abs(point.y - box.maxY); handle.bottom = !handle.top }
            else { handle.top = nearTop; handle.bottom = nearBottom }
        }
        if handle != Handle() { return handle }
        return box.contains(point) ? .move : nil
    }

    /// Moves the chosen sides by (dx, dy), keeping the box inside the photo and at least `minimumSide`.
    static func adjusted(_ start: CGRect, handle: Handle, dx: CGFloat, dy: CGFloat) -> CGRect {
        if handle.isMove {
            var moved = start.offsetBy(dx: dx, dy: dy)
            moved.origin.x = min(max(moved.minX, 0), 1 - moved.width)
            moved.origin.y = min(max(moved.minY, 0), 1 - moved.height)
            return moved
        }
        var minX = start.minX, maxX = start.maxX, minY = start.minY, maxY = start.maxY
        if handle.left { minX = min(max(minX + dx, 0), maxX - minimumSide) }
        if handle.right { maxX = max(min(maxX + dx, 1), minX + minimumSide) }
        if handle.top { minY = min(max(minY + dy, 0), maxY - minimumSide) }
        if handle.bottom { maxY = max(min(maxY + dy, 1), minY + minimumSide) }
        return CGRect(x: minX, y: minY, width: maxX - minX, height: maxY - minY)
    }

    /// Kept for callers that resize one corner (tests); same rules as `adjusted`.
    static func resized(_ start: CGRect, movingLeft: Bool, movingTop: Bool, dx: CGFloat, dy: CGFloat) -> CGRect {
        adjusted(start, handle: Handle(left: movingLeft, top: movingTop, right: !movingLeft, bottom: !movingTop), dx: dx, dy: dy)
    }

    /// The photo fitted inside the area, inset enough that every handle stays clear of the screen edges.
    static func fittedFrame(_ imageSize: CGSize, in container: CGSize) -> CGRect {
        let inset: CGFloat = 32
        let area = CGSize(width: max(container.width - inset * 2, 1), height: max(container.height - inset * 2, 1))
        guard imageSize.width > 0, imageSize.height > 0 else { return CGRect(origin: .zero, size: container) }
        let scale = min(area.width / imageSize.width, area.height / imageSize.height)
        let size = CGSize(width: imageSize.width * scale, height: imageSize.height * scale)
        return CGRect(x: (container.width - size.width) / 2, y: (container.height - size.height) / 2,
                      width: size.width, height: size.height)
    }
}
