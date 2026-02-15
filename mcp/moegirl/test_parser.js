/**
 * 测试页面解析器
 */

import { PageContentParser } from './dist/core/page_content_parser.js';

// 模拟萌娘百科的标题格式
const testContent = `
{{一些模板内容}}

==命名==
初音未来的名字来源于...

==音源==
音源是藤田咲...

===V2===
第二版本的介绍

==声库==
声库的详细信息
`;

console.log('开始测试页面解析器...\n');

// 解析页面
const structure = PageContentParser.parsePage('测试页面', testContent);

console.log('='.repeat(50));
console.log('解析结果：');
console.log('='.repeat(50));

console.log('\n📋 标题列表 (headings):');
structure.headings.forEach((h, i) => {
  console.log(`  ${i + 1}. "${h.title}" (level=${h.level}, line=${h.line})`);
});

console.log('\n📑 段落列表 (sections):');
structure.sections.forEach((s, i) => {
  if (s.type === 'heading') {
    console.log(`  ${i + 1}. [标题] "${s.title}" (level=${s.level})`);
  } else if (s.type === 'template') {
    console.log(`  ${i + 1}. [模板] "${s.templateName}"`);
  } else {
    console.log(`  ${i + 1}. [内容] ${s.content.substring(0, 30)}...`);
  }
});

console.log('\n🔍 测试查找标题 "命名":');
const content1 = PageContentParser.getContentByTitle(structure, '命名');
console.log('找到的内容:', content1 ? `"${content1.substring(0, 50)}..."` : '未找到');

console.log('\n🔍 测试查找标题 "音源":');
const content2 = PageContentParser.getContentByTitle(structure, '音源');
console.log('找到的内容:', content2 ? `"${content2.substring(0, 50)}..."` : '未找到');

console.log('\n🔍 测试查找标题 "V2":');
const content3 = PageContentParser.getContentByTitle(structure, 'V2');
console.log('找到的内容:', content3 ? `"${content3.substring(0, 50)}..."` : '未找到');

console.log('\n' + '='.repeat(50));
console.log('测试完成！');
console.log('='.repeat(50));