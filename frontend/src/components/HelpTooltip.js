import React from 'react';
import './HelpTooltip.css';

/**
 * Small (?) control with a plain-language explanation on hover/focus.
 */
function HelpTooltip({ text, label = 'What does this mean?' }) {
  return (
    <span className="help-tooltip">
      <button
        type="button"
        className="help-tooltip-trigger"
        aria-label={label}
        title={text}
      >
        ?
      </button>
      <span className="help-tooltip-bubble" role="tooltip">
        {text}
      </span>
    </span>
  );
}

export default HelpTooltip;
