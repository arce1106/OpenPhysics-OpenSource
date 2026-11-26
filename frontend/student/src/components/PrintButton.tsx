interface PrintButtonProps {
  label?: string;
  disabled?: boolean;
}

declare global {
  interface Window {
    OpenPhysicsPrint?: {
      print: () => void;
    };
  }
}

export default function PrintButton({ label = '打印题单', disabled = false }: PrintButtonProps) {
  const handlePrint = () => {
    if (disabled) return;

    try {
      if (window.OpenPhysicsPrint?.print) {
        window.OpenPhysicsPrint.print();
        return;
      }
    } catch {
      // Fall back to the browser print dialog if the native bridge is unavailable.
    }

    window.print();
  };

  return (
    <button
      className="print-button no-print"
      type="button"
      onClick={handlePrint}
      disabled={disabled}
    >
      {label}
    </button>
  );
}
