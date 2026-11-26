package cn.openphysics.androidapp.ui.screens

/**
 * Host-level styling for the shared learning-content / question Pane on phones, mirroring the
 * iOS PaneWebViewChrome so the backend Pane itself stays unchanged. All selectors are scoped to
 * `.op-pane-phone`, so tablet layouts are unaffected.
 */
internal object PhonePaneChrome {
    val script: String = """
        (function() {
          if (document.getElementById('op-phone-pane-chrome')) return;
          var style = document.createElement('style');
          style.id = 'op-phone-pane-chrome';
          style.textContent = `
            .op-pane-root.op-pane-phone :is(.op-pane-phone-explanation, .op-pane-phone-original) > summary {
              list-style: none; display: flex; align-items: center; justify-content: space-between;
              min-height: 44px; line-height: 1.4; color: #182c30;
            }
            .op-pane-root.op-pane-phone :is(.op-pane-phone-explanation, .op-pane-phone-original) > summary::-webkit-details-marker { display: none; }
            .op-pane-root.op-pane-phone :is(.op-pane-phone-explanation, .op-pane-phone-original) > summary::after {
              content: ""; flex: none; width: 8px; height: 8px; margin: 0 6px 0 12px;
              border-right: 2px solid #9aa6a4; border-bottom: 2px solid #9aa6a4;
              transform: rotate(-45deg); transition: transform .2s ease;
            }
            .op-pane-root.op-pane-phone :is(.op-pane-phone-explanation, .op-pane-phone-original)[open] > summary::after { transform: rotate(45deg); }
          `;
          (document.head || document.documentElement).appendChild(style);
        })();
    """.trimIndent()
}
