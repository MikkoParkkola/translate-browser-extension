/* @refresh reload */
import { render } from 'solid-js/web';
import Options from './Options';

const root = document.getElementById('root');

if (root) {
  render(() => <Options />, root);
}
