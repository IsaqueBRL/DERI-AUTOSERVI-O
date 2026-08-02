// =====================================================================================
// LÓGICA COMPARTILHADA - PC + MOBILE
// =====================================================================================
// Este arquivo reúne as funções de regra de negócio que eram IDÊNTICAS (ou só com
// comentários diferentes) nos dois sites. A partir de agora existe UMA cópia só,
// usada tanto pelo index_PC.html quanto pelo index_MOBILE.html.
//
// Diferença importante em relação às versões antigas: como este arquivo não tem
// acesso direto às variáveis internas de cada site (allLoadedProducts, allLoadedLocais,
// allLoadedSales, db, etc.), essas funções agora RECEBEM esses dados como parâmetro,
// em vez de "adivinhar" de fora. Cada site continua controlando seus próprios dados;
// só a lógica de cálculo em cima deles é que passou a ser uma coisa só.
//
// Se algum dia precisar mudar uma regra de estoque por local ou de cálculo de
// crédito de cliente, muda SÓ AQUI, e o PC e o Mobile já ficam certos os dois juntos.
// =====================================================================================

// Soma o estoque de um produto em todos os locais (ou usa o campo antigo "readyStock"
// se o produto ainda não tiver sido migrado para estoque por local).
export function getEstoqueTotal(prod) {
    if (!prod) return 0;
    if (prod.estoquePorLocal && typeof prod.estoquePorLocal === 'object') {
        return Object.values(prod.estoquePorLocal).reduce((s, v) => s + (parseFloat(v) || 0), 0);
    }
    return parseFloat(prod?.readyStock || 0);
}

// Devolve os locais cadastrados, ordenados pela ordem de criação (mais antigo primeiro).
export function localKeysOrdenados(allLoadedLocais) {
    return Object.keys(allLoadedLocais).sort((a, b) => (allLoadedLocais[a].criadoEm || 0) - (allLoadedLocais[b].criadoEm || 0));
}

// Devolve o nome de um local a partir da chave, com um texto de fallback caso o
// local tenha sido excluído (produto/venda antigos que ainda referenciam ele).
export function nomeDoLocal(localKey, allLoadedLocais) {
    return (allLoadedLocais[localKey] && allLoadedLocais[localKey].nome) || 'Local removido';
}

// Migração "de leitura": para um produto antigo que só tinha readyStock (sem estoque
// por local ainda), monta um mapa {localKey: quantidade} jogando tudo no primeiro
// local cadastrado. Não grava nada no banco, só ajuda a exibir/calcular em memória.
export function construirPorLocalLegado(prod, allLoadedLocais) {
    const obj = {};
    const chaves = localKeysOrdenados(allLoadedLocais);
    chaves.forEach(k => { obj[k] = 0; });
    if (chaves.length > 0) obj[chaves[0]] = parseFloat(prod?.readyStock || 0);
    return obj;
}

// Devolve o mapa completo {localKey: quantidade} de um produto, já incluindo com 0
// qualquer local cadastrado que o produto ainda não tenha no seu mapa salvo.
export function getEstoquePorLocalCompleto(prod, allLoadedLocais) {
    if (!prod) return {};
    if (prod.estoquePorLocal && typeof prod.estoquePorLocal === 'object') {
        const completo = { ...prod.estoquePorLocal };
        localKeysOrdenados(allLoadedLocais).forEach(k => { if (!(k in completo)) completo[k] = 0; });
        return completo;
    }
    return construirPorLocalLegado(prod, allLoadedLocais);
}

// Ajusta em MEMÓRIA (sem gravar no banco ainda) o estoque de um produto num local
// específico, somando/subtraindo "delta". Usado durante um checkout ou edição de
// venda, antes de persistir tudo de uma vez no final da operação.
export function ajustarEstoqueMemoria(prodKey, localKey, delta, allLoadedProducts, allLoadedLocais) {
    const p = allLoadedProducts[prodKey];
    if (!p || !localKey || !delta) return;
    const mapa = getEstoquePorLocalCompleto(p, allLoadedLocais);
    mapa[localKey] = parseFloat(((parseFloat(mapa[localKey]) || 0) + delta).toFixed(3));
    p.estoquePorLocal = mapa;
    p.readyStock = Object.values(mapa).reduce((s, v) => s + (parseFloat(v) || 0), 0);
}

// Grava no Firebase o estoque por local (e o total) de um produto, a partir do que
// já está em memória (normalmente depois de uma ou mais chamadas a ajustarEstoqueMemoria).
export function persistirEstoqueMemoria(prodKey, allLoadedProducts, allLoadedLocais, db, ref, set) {
    const p = allLoadedProducts[prodKey];
    if (!p) return Promise.resolve();
    const mapa = getEstoquePorLocalCompleto(p, allLoadedLocais);
    const total = Object.values(mapa).reduce((s, v) => s + (parseFloat(v) || 0), 0);
    p.estoquePorLocal = mapa;
    p.readyStock = total;
    return Promise.all([
        set(ref(db, `produtos/${prodKey}/estoquePorLocal`), mapa),
        set(ref(db, `produtos/${prodKey}/readyStock`), total)
    ]);
}

// Calcula o saldo de crédito atual de um cliente, somando transações diretas de
// crédito (Aba 5/6) e o crédito gerado/usado dentro de vendas normais já pagas.
export function calcularCreditoCliente(nomeCliente, allLoadedSales) {
    if (!nomeCliente) return 0;
    const nomeLower = nomeCliente.toLowerCase();
    let credito = 0;
    Object.values(allLoadedSales).forEach(s => {
        if ((s.clientName || '').toLowerCase() !== nomeLower) return;
        if (s.origemCredito) {
            // Transação direta de crédito (Aba 5): totalValue já vem com o sinal correto
            // (positivo em "Adicionado", negativo em "Retirada")
            credito += parseFloat(s.totalValue || 0);
        } else if ((s.status || 'PAGO') === 'PAGO') {
            // Crédito gerado/usado dentro de uma venda normal (paga com valor a mais / abatida com crédito)
            credito += parseFloat(s.creditoGerado || 0) - parseFloat(s.creditoUsado || 0);
        }
    });
    return Math.max(0, parseFloat(credito.toFixed(2)));
}
