import test from 'node:test';
import assert from 'node:assert/strict';
import {fitWithin, jpegName, needsShrink, IMAGE_TARGET} from '../src/image-shrink.mjs';

test('large photos fit within the long side, small ones keep their size', () => {
  assert.deepEqual(fitWithin(4032, 3024), {width: 2400, height: 1800});
  assert.deepEqual(fitWithin(3024, 4032), {width: 1800, height: 2400});
  assert.deepEqual(fitWithin(1200, 800), {width: 1200, height: 800});
});
test('only big PNG/JPEG/WebP files are re-encoded, as .jpg', () => {
  assert.equal(needsShrink({type: 'image/jpeg', size: IMAGE_TARGET + 1}), true);
  assert.equal(needsShrink({type: 'image/png', size: 1024}), false);
  assert.equal(needsShrink({type: 'image/gif', size: IMAGE_TARGET * 3}), false);
  assert.equal(needsShrink({type: 'application/zip', size: IMAGE_TARGET * 3}), false);
  assert.equal(jpegName('截图 1.PNG'), '截图 1.jpg');
  assert.equal(jpegName('photo.jpeg'), 'photo.jpg');
});
