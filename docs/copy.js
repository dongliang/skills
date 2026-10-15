// 给代码块加"复制"按钮。
// 复制纯命令本身：去掉提示符、注释行和装饰空行，不把输出内容混进去。
(function () {
  // 行首提示符：$ 或 >
  var PROMPT = /^[ \t]*[$>][ \t]/;
  // 整行注释（# 开头）
  var COMMENT = /^[ \t]*#[ \t]?/;

  function clean(pre) {
    var code = pre.querySelector('code') || pre;
    // 用 textContent 避免把按钮上的字带进来
    var lines = code.textContent.split('\n');

    var out = [];
    lines.forEach(function (line) {
      var l = line.replace(/[ \t]+$/, '');
      if (COMMENT.test(l)) return;   // 说明性注释不进剪贴板
      l = l.replace(PROMPT, '');
      if (l.trim() === '') return;   // 丢掉装饰空行
      out.push(l);
    });

    return out.join('\n').replace(/^\n+|\n+$/g, '');
  }

  function attach(pre) {
    if (pre.dataset.copyReady) return;
    pre.dataset.copyReady = '1';

    if (getComputedStyle(pre).position === 'static') {
      pre.style.position = 'relative';
    }
    pre.classList.add('has-copy');

    var btn = document.createElement('button');
    btn.className = 'copy-btn';
    btn.type = 'button';
    btn.textContent = '复制';
    btn.setAttribute('aria-label', '复制命令');

    btn.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      var text = clean(pre);

      var done = function () {
        btn.textContent = '已复制';
        btn.classList.add('done');
        setTimeout(function () {
          btn.textContent = '复制';
          btn.classList.remove('done');
        }, 1400);
      };

      var fallback = function () {
        var ta = document.createElement('textarea');
        ta.value = text;
        ta.setAttribute('readonly', '');
        ta.style.cssText = 'position:absolute;left:-9999px;top:0';
        document.body.appendChild(ta);
        ta.select();
        ta.setSelectionRange(0, ta.value.length);
        try { document.execCommand('copy'); done(); }
        catch (err) { btn.textContent = '复制失败'; }
        document.body.removeChild(ta);
      };

      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(done, fallback);
      } else {
        fallback();
      }
    });

    pre.appendChild(btn);
  }

  function init() {
    document.querySelectorAll('pre').forEach(function (pre) {
      // 终端演示卡里混着输出内容，整块跳过
      if (pre.closest('[data-no-copy]')) return;
      attach(pre);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
