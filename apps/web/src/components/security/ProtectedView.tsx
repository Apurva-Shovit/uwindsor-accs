import React, { useEffect, useRef } from 'react';
import { isNative } from '../../lib/platform';
import { nativePrint } from '../../lib/printer';

interface ProtectedViewProps {
  children: React.ReactNode;
  allowPrint?: boolean;
  className?: string;
}

// Global flag to track authorized print invocation
let isAuthorizedPrint = false;

/**
 * @param onBeforePrint runs once the print-only body class is applied.
 * @param onAfterPrint  runs once the print job has been handed off and any
 *   print-only DOM is safe to tear down. Callers that build a print portal must
 *   use this rather than their own timer: on Android the document is rendered
 *   only after the user confirms in the system print dialog, so a fixed timeout
 *   would remove the portal before it is ever rasterised.
 */
export const triggerAuthorizedPrint = (onBeforePrint?: () => void, onAfterPrint?: () => void) => {
  isAuthorizedPrint = true;
  document.body.classList.add('authorized-print');
  if (onBeforePrint) onBeforePrint();

  const finish = () => {
    document.body.classList.remove('authorized-print');
    isAuthorizedPrint = false;
    if (onAfterPrint) onAfterPrint();
  };

  setTimeout(() => {
    if (isNative()) {
      // window.print() does nothing in a WebView — go through Android's
      // PrintManager instead, which still honours the @media print CSS.
      // nativePrint guarantees `finish` runs exactly once, including on failure.
      void nativePrint('ACARE Report', finish).catch((err) => {
        console.error('Print failed', err);
      });
    } else {
      window.print();
      setTimeout(finish, 500);
    }
  }, 100);
};

export const ProtectedView: React.FC<ProtectedViewProps> = ({ children, allowPrint = false, className = '' }) => {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // 1. Block Keyboard Shortcuts (Ctrl+C, Ctrl+A, Ctrl+U, Ctrl+P, F12, DevTools)
    const handleKeyDown = (e: KeyboardEvent) => {
      const isCtrl = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();

      // F12 or DevTools shortcuts (Ctrl+Shift+I / J / C)
      if (
        e.key === 'F12' || 
        (isCtrl && e.shiftKey && (key === 'i' || key === 'j' || key === 'c'))
      ) {
        e.preventDefault();
        e.stopPropagation();
        return false;
      }

      // Copy, Select All, Cut, View Source, Save
      if (isCtrl && (key === 'c' || key === 'a' || key === 'x' || key === 'u' || key === 's')) {
        e.preventDefault();
        e.stopPropagation();
        return false;
      }

      // Print (Ctrl+P) - block unless authorized print button was clicked
      if (isCtrl && key === 'p') {
        if (!allowPrint || !isAuthorizedPrint) {
          e.preventDefault();
          e.stopPropagation();
          alert('Printing on this page is strictly restricted to the official Print Report button.');
          return false;
        }
      }
    };

    // 2. DevTools Debugger Guard Loop to hinder DOM Inspection.
    // Skipped in the Android app: there are no DevTools to guard against on a
    // device, and a `debugger` statement every second is a constant battery
    // drain that also makes chrome://inspect unusable for support work.
    const devToolsInterval = isNative()
      ? undefined
      : setInterval(() => {
          const startTime = performance.now();
          // Executing debugger pauses execution if DevTools is open
          (function() {
            // eslint-disable-next-line no-debugger
            debugger;
          })();
          const endTime = performance.now();
          if (endTime - startTime > 100) {
            // DevTools opened detection safeguard
          }
        }, 1000);

    window.addEventListener('keydown', handleKeyDown, true);

    return () => {
      window.removeEventListener('keydown', handleKeyDown, true);
      if (devToolsInterval !== undefined) clearInterval(devToolsInterval);
    };
  }, [allowPrint]);

  const preventEvent = (e: React.SyntheticEvent) => {
    e.preventDefault();
    e.stopPropagation();
    return false;
  };

  return (
    <div
      ref={containerRef}
      onCopy={preventEvent}
      onCut={preventEvent}
      onDragStart={preventEvent}
      onContextMenu={preventEvent}
      className={`select-none transition-all ${className}`}
      style={{
        WebkitUserSelect: 'none',
        MozUserSelect: 'none',
        msUserSelect: 'none',
        userSelect: 'none',
        WebkitTouchCallout: 'none',
      }}
    >
      {children}
    </div>
  );
};
