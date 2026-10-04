import assert from "node:assert/strict";
import { locateAnnotation, groupAnnotationRanges } from "../public/annotation-layout.js";

assert.deepEqual(locateAnnotation("甲乙甲乙", {quote:"甲乙",quoteOffset:2}), {start:2,end:4});
assert.deepEqual(locateAnnotation("她正在\n\n 看书。", {quote:"她正在看书。"}), {start:0,end:9});
assert.equal(locateAnnotation("原文内容", {quote:"不同的改写"}), null);
assert.equal(locateAnnotation("甲 乙；甲 乙", {quote:"甲乙"}), null);
assert.deepEqual(locateAnnotation("甲 乙；甲 乙", {quote:"甲乙",quoteOffset:4}), {start:4,end:7});
assert.equal(locateAnnotation("正文", {quote:"  "}), null);

const groups = groupAnnotationRanges("0123456789", [
  {id:"a",quote:"1234",quoteOffset:1},
  {id:"b",quote:"3456",quoteOffset:3},
  {id:"c",quote:"678",quoteOffset:6},
  {id:"d",quote:"9",quoteOffset:9},
  {id:"reply",parentId:"a",quote:"1"},
]);
assert.equal(groups.length,2);
assert.deepEqual(groups[0].notes.map(note=>note.id), ["a","b","c"]);
assert.deepEqual([groups[0].start,groups[0].end], [1,9]);
assert.equal(groups[1].notes[0].id,"d");
console.log("annotation layout regression checks passed");
