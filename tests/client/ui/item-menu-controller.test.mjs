import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { mountItemMenuController } from '../../../src/features/navigation/item-menu-controller.ts';

test('item menus position within the viewport and close when the user clicks outside', () => {
  const dom = new JSDOM('<details class="item-menu"><summary>More</summary><div class="item-menu-panel"><button>Action</button></div></details><button id="outside">Outside</button>', { pretendToBeVisual: true });
  const { document, MouseEvent } = dom.window;
  const callbacks = new Map();
  let nextFrame = 0;
  dom.window.innerWidth = 1024;
  dom.window.innerHeight = 500;
  dom.window.requestAnimationFrame = callback => {
    const id = ++nextFrame;
    callbacks.set(id, callback);
    return id;
  };
  const menu = document.querySelector('.item-menu');
  const panel = menu.querySelector('.item-menu-panel');
  menu.getBoundingClientRect = () => ({ top: 410, bottom: 430, left: 12, right: 100, width: 88, height: 20, x: 12, y: 410, toJSON() {} });
  Object.defineProperty(panel, 'scrollHeight', { value: 260 });
  panel.getBoundingClientRect = () => ({ top: 0, bottom: 0, left: 12, right: 120, width: 108, height: 0, x: 12, y: 0, toJSON() {} });
  const controller = mountItemMenuController(document, dom.window);

  document.querySelector('summary').dispatchEvent(new MouseEvent('click', { bubbles: true }));
  const [id, callback] = callbacks.entries().next().value;
  callback();
  callbacks.delete(id);
  assert.equal(menu.classList.contains('opens-up'), true, 'the menu opens above when there is not enough room below');
  assert.equal(panel.style.maxHeight, '325px', 'the popup height is capped to available viewport space');

  document.querySelector('#outside').dispatchEvent(new MouseEvent('click', { bubbles: true }));
  assert.equal(menu.open, false, 'an outside click closes the open menu');
  menu.dispatchEvent(new dom.window.Event('toggle'));
  assert.equal(menu.classList.contains('opens-up'), false, 'closing the menu clears its placement state');
  assert.equal(panel.style.maxHeight, '', 'closing the menu clears its temporary height');

  controller.destroy();
  dom.window.close();
});

test('a mobile menu stays inside the content viewport when either alignment would overflow', () => {
  const dom = new JSDOM('<details class="item-menu" open><summary>更多</summary><div class="item-menu-panel">Actions</div></details>', { pretendToBeVisual: true });
  const { document } = dom.window;
  dom.window.innerWidth = 411;
  dom.window.innerHeight = 844;
  Object.defineProperty(document.documentElement, 'clientWidth', { value: 391 });
  let frame;
  dom.window.requestAnimationFrame = callback => { frame = callback; return 1; };
  const menu = document.querySelector('.item-menu');
  const panel = document.querySelector('.item-menu-panel');
  menu.getBoundingClientRect = () => ({ top: 240, bottom: 276 });
  panel.getBoundingClientRect = () => ({ left: 177, right: 457, width: 280 });
  Object.defineProperty(panel, 'scrollHeight', { value: 220 });
  const controller = mountItemMenuController(document, dom.window);
  controller.schedulePosition();
  frame();
  assert.equal(panel.style.translate, '-74px 0', 'right overflow is corrected against clientWidth, excluding the scrollbar');
  menu.open = false;
  menu.dispatchEvent(new dom.window.Event('toggle'));
  assert.equal(panel.style.translate, '', 'closing removes the correction before the next layout');
  controller.destroy();
  dom.window.close();
});
