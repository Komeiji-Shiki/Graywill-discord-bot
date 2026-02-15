/**
 * 直接测试解析器对真实萌娘百科内容的解析
 */

import { PageContentParser } from './dist/core/page_content_parser.js';

// 模拟真实的萌娘百科内容
const realContent = `
一些开头内容...

== 命名 ==
早在2007年6月30日或之前...

== 音源 ==
初音未来（V2）的音源样本...

== 声库软件版本及形象设定 ==
从2012年12月起...

=== V2 ===
V2版本内容...

=== V3 ===
V3版本内容...
`;

console.log('🔍 测试解析器对真实格式的支持\n');
console.log('=' .repeat(70));

// 解析内容
const structure = PageContentParser.parsePage('测试页面', realContent);

console.log('\n📋 解析得到的标题 (headings):');
structure.headings.forEach((h, i) => {
  console.log(`  ${i + 1}. "${h.title}" (level=${h.level}, line=${h.line})`);
});

console.log('\n📑 解析得到的段落 (sections):');
structure.sections.forEach((s, i) => {
  if (s.type === 'heading') {
    console.log(`  ${i + 1}. [标题] "${s.title}" (level=${s.level})`);
  } else if (s.type === 'template') {
    console.log(`  ${i + 1}. [模板] "${s.templateName}"`);
  } else {
    const preview = s.content.substring(0, 30).replace(/\n/g, ' ');
    console.log(`  ${i + 1}. [内容] ${preview}...`);
  }
});

// 测试查找功能
console.log('\n' + '=' .repeat(70));
console.log('🔍 测试查找标题功能\n');

const testTitles = ['命名', '音源', '声库', 'V2', 'V3'];

for (const title of testTitles) {
  console.log(`查找 "${title}":`);
  
  // 方法1: 使用 findSectionsByTitle
  const sections = PageContentParser.findSectionsByTitle(structure, title);
  console.log(`  findSectionsByTitle: 找到 ${sections.length} 个`);
  
  // 方法2: 使用 getContentByTitle
  const content = PageContentParser.getContentByTitle(structure, title);
  if (content) {
    const preview = content.substring(0, 50).replace(/\n/g, ' ');
    console.log(`  getContentByTitle: ✅ "${preview}..."`);
  } else {
    console.log(`  getContentByTitle: ❌ 未找到`);
  }
  
  console.log();
}

console.log('=' .repeat(70));
console.log('✅ 测试完成');