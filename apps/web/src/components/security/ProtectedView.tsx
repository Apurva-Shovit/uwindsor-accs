import React, { useEffect, useRef } from 'react';

interface ProtectedViewProps {
  children: React.ReactNode;
  allowPrint?: boolean;
  className?: string;
}

// Global flag to track authorized print invocation
let isAuthorizedPrint = false;

export const triggerAuthorizedPrint = (onBeforePrint?: () => void) => {
  isAuthorizedPrint = true;
  document.body.classList.add('authorized-print');
  if (onBeforePrint) onBeforePrint();
  
  setTimeout(() => {
    window.print();
    setTimeout(() => {
      document.body.classList.remove('authorized-print');
      isAuthorizedPrint = false;
    }, 500);
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

    // 2. DevTools Debugger Guard Loop to hinder DOM Inspection
    const devToolsInterval = setInterval(() => {
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
      clearInterval(devToolsInterval);
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
