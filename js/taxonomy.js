/**
 * TaxonomyManager: 维护 code -> label_zh 映射的内存查表层
 * 启动时建立 code->item, code->label_zh, code->description 映射
 */
class TaxonomyManager {
    constructor() {
        this.domains = new Map();
        this.semantics = new Map();
        this.pos = new Map();
        this.registers = new Map();
        this.transitivity = new Map();
        this.styles = new Map();
        this.freqBands = new Map();
        this.allWords = [];
    }

    /**
     * 将 items 数组注册到指定 map 中
     */
    addTaxonomyItems(map, itemsData) {
        if (!itemsData || !Array.isArray(itemsData)) return;
        itemsData.forEach(function(item) {
            if (item && item.code) {
                map.set(item.code, item);
            }
        });
    }

    setWords(wordsArray) {
        this.allWords = wordsArray;
    }

    /**
     * 核心翻译映射：code -> label_zh，fallback 到原始 code
     */
    getLabel(type, code) {
        const metadata = window.JPLearn && window.JPLearn.lexicalMetadata;
        if (metadata && code && typeof code === 'object') {
            if (type === 'pos') return metadata.posLabel(code, 'zh');
            if (type === 'register') return metadata.registerLabel(code, 'zh');
            if (type === 'transitivity') return metadata.transitivityLabel(code, 'zh');
        }
        var map = this._getMap(type);
        if (!map) return code;
        var item = map.get(code);
        return item ? (item.label_zh || item.label || code) : code;
    }

    getDescription(type, code) {
        var map = this._getMap(type);
        if (!map) return '';
        var item = map.get(code);
        return item ? (item.description || '') : '';
    }

    getItem(type, code) {
        var map = this._getMap(type);
        if (!map) return null;
        return map.get(code) || null;
    }

    _getMap(type) {
        switch(type) {
            case 'domain': return this.domains;
            case 'semantic': return this.semantics;
            case 'pos': return this.pos;
            case 'register': return this.registers;
            case 'transitivity': return this.transitivity;
            case 'style': return this.styles;
            case 'freq_band': return this.freqBands;
            default: return null;
        }
    }
}

window.taxonomyManager = new TaxonomyManager();
