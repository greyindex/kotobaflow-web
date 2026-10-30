/**
 * ListView: 分页列表视图
 *
 * [v3] 增强：
 *   - 批量选择（全选/单选）
 *   - 批量加入学习队列
 *   - 生成学习队列按钮
 */
function ListView(containerId) {
    this.container = document.getElementById(containerId);
    this.filteredWords = [];
    this.words = [];
    this.currentPage = 1;
    this.pageSize = 50;
    this.totalPages = 1;
    this.selectedIndices = new Set();
    this.sortMode = 'default';
    this.showFavOnly = false;
    this.hideMeanings = false;
}

/**
 * 设置数据源（已过滤的词条数组）
 */
ListView.prototype.setData = function(words) {
    this.filteredWords = words;
    this.currentPage = 1;
    this.selectedIndices = new Set();
    this._buildDisplay();
};

ListView.prototype._buildDisplay = function() {
    var words = [];
    for (var i = 0; i < this.filteredWords.length; i++) {
        if (!this.showFavOnly || window.StudyStorage.getWordStatus(this.filteredWords[i].index).isFavorite) {
            words.push(this.filteredWords[i]);
        }
    }

    switch (this.sortMode) {
        case 'index':
            words.sort(function(a, b) { return a.index - b.index; });
            break;
        case 'alpha':
            words.sort(function(a, b) { return a.word.localeCompare(b.word, 'ja'); });
            break;
        case 'shuffle':
            words = window.appConfig.getShuffled(words);
            break;
    }

    this.words = words;
    this._recalcPages();
};

ListView.prototype.reshuffle = function() {
    window.appConfig.reshuffleShared();
    this.currentPage = 1;
    this._buildDisplay();
    this.render();
};

ListView.prototype.setPageSize = function(n) {
    this.pageSize = n;
    this.currentPage = 1;
    this._recalcPages();
};

ListView.prototype._recalcPages = function() {
    this.totalPages = Math.max(1, Math.ceil(this.words.length / this.pageSize));
    if (this.currentPage > this.totalPages) {
        this.currentPage = this.totalPages;
    }
};

/**
 * 渲染当前页
 */
ListView.prototype._updateBatchBar = function() {
    var countEl = document.getElementById('listSelectedCount');
    var batchBtn = document.getElementById('btnBatchStudy');
    if (countEl) countEl.textContent = '已选 ' + this.selectedIndices.size + ' 条';
    if (batchBtn) batchBtn.disabled = (this.selectedIndices.size === 0);
};

ListView.prototype._updateReadPageButton = function(playing) {
    var button = document.getElementById('listReadPage');
    if (!button) return;
    var label = playing ? '暂停当页朗读' : '朗读当页单词';
    button.innerHTML = uiIcon(playing ? 'pause' : 'play');
    button.title = label;
    button.setAttribute('aria-label', label);
};

ListView.prototype._findWordByIndex = function(idx) {
    for (var i = 0; i < this.words.length; i++) {
        if (this.words[i].index === idx) return this.words[i];
    }
    return null;
};

ListView.prototype._truncate = function(str, maxLen) {
    if (!str) return '';
    return str.length > maxLen ? str.substring(0, maxLen) + '...' : str;
};

ListView.prototype._esc = function(str) {
    return window.JPLearn.html.escape(str);
};
window.JPLearn.installListRenderer(ListView);
window.JPLearn.installListEvents(ListView);
