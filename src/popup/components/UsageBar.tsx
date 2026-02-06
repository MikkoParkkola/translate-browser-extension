import { Component } from 'solid-js';
import type { UsageStats } from '../../types';

interface Props {
  usage: UsageStats;
}

export const UsageBar: Component<Props> = (props) => {
  const requestLimit = 100;
  const charLimit = 50000;

  const requestPercent = () => Math.min((props.usage.today.requests / requestLimit) * 100, 100);
  const charPercent = () => Math.min((props.usage.today.characters / charLimit) * 100, 100);

  const formatChars = (chars: number) => {
    if (chars >= 1000) {
      return `${(chars / 1000).toFixed(1)}k`;
    }
    return chars.toString();
  };

  return (
    <section class="usage-section">
      <div class="usage-header">
        <span class="usage-title">Today:</span>
        <span class="usage-summary">
          {props.usage.today.requests}/{requestLimit} req, {formatChars(props.usage.today.characters)}/
          {formatChars(charLimit)} chars
        </span>
      </div>
      <div class="usage-bars">
        <div class="usage-bar">
          <div class="usage-bar-track">
            <div
              class="usage-bar-fill"
              style={{ width: `${requestPercent()}%` }}
              data-type="requests"
            />
          </div>
        </div>
        <div class="usage-bar">
          <div class="usage-bar-track">
            <div class="usage-bar-fill" style={{ width: `${charPercent()}%` }} data-type="chars" />
          </div>
        </div>
      </div>
    </section>
  );
};
