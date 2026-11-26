import { useEffect, useId, useRef, useState } from 'react';

export function getAndroidAppAssets() {
  return {
    apkUrl: import.meta.env.VITE_ANDROID_APK_URL?.trim() || '',
    qrUrl: import.meta.env.VITE_ANDROID_DOWNLOAD_QR_URL?.trim() || '',
    previewUrl: import.meta.env.VITE_ANDROID_TABLET_PREVIEW_URL?.trim() || '',
  };
}

export function AndroidAppDownloadMenu() {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverId = useId();
  const assets = getAndroidAppAssets();

  useEffect(() => {
    if (!open) return;

    const closeOnPointerDown = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setOpen(false);
      triggerRef.current?.focus();
    };

    document.addEventListener('pointerdown', closeOnPointerDown);
    document.addEventListener('keydown', closeOnEscape);

    return () => {
      document.removeEventListener('pointerdown', closeOnPointerDown);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [open]);

  if (!assets.apkUrl) return null;

  return (
    <div className="navbar-app-download-menu" ref={menuRef}>
      <button
        ref={triggerRef}
        type="button"
        className="navbar-app-download"
        aria-controls={popoverId}
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen(current => !current)}
      >
        获取 APP
      </button>

      {open ? (
        <div id={popoverId} className="app-download-popover" role="dialog" aria-label="获取OpenPhysics APP">
          <a
            className="app-download-popover-qr"
            href={assets.apkUrl}
            download="YuanzhiPhysics-Android.apk"
            aria-label="下载OpenPhysics安卓 APP"
          >
            {assets.qrUrl ? <img src={assets.qrUrl} alt="OpenPhysics安卓应用下载二维码" /> : null}
            <span className="app-download-popover-action">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M12 3v12m-4-4 4 4 4-4M5 16v4h14v-4" />
              </svg>
              下载安卓 APP
            </span>
          </a>
        </div>
      ) : null}
    </div>
  );
}
