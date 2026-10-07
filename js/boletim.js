// Boletim no modelo da escola (notas e faltas 1º–4º bimestre), 2 por folha A4, sem fundo colorido.
import { DISCIPLINAS, NOME_DISC, BIMESTRES, notaFinal, parseInt0, fmt } from './comum.js';

// Organiza as planilhas da turma: mapa[disc][bim] = { alunoId: lançamento }
export function indexarPlanilhas(planilhas) {
  const m = {};
  (planilhas || []).forEach(p => {
    m[p.disc] = m[p.disc] || {};
    m[p.disc][Number(p.bim)] = p.alunos || {};
  });
  return m;
}

// Linhas do boletim de um aluno
export function linhasBoletim(alunoId, mapa) {
  return DISCIPLINAS.map(d => {
    const notas = [], faltas = [], obs = [];
    let total = 0, temFalta = false;
    BIMESTRES.forEach(b => {
      const e = (mapa[d.id] && mapa[d.id][b] && mapa[d.id][b][alunoId]) || null;
      notas.push(notaFinal(e));
      const f = e ? parseInt0(e.faltas) : null;
      faltas.push(f);
      if (f !== null) { total += f; temFalta = true; }
      if (e && e.obs) obs.push({ bim: b, texto: e.obs });
    });
    return { disc: d.id, nome: d.nome, notas, faltas, total: temFalta ? total : null, obs };
  });
}

export function gerarBoletinsPDF({ escola, turma, alunos, planilhas, logo, incluirObs }) {
  const { jsPDF } = window.jspdf;
  const pdf = new jsPDF({ unit: 'mm', format: 'a4' });
  const W = pdf.internal.pageSize.getWidth();
  const M = 12;
  const mapa = indexarPlanilhas(planilhas);
  const SLOT = [10, 152];
  alunos.forEach((a, i) => {
    if (i > 0 && i % 2 === 0) pdf.addPage();
    let y = SLOT[i % 2];
    if (i % 2 === 1) { // linha pontilhada de corte entre os dois boletins
      pdf.setDrawColor(170); pdf.setLineDashPattern([1.2, 1.2], 0); pdf.line(M, 148.5, W - M, 148.5); pdf.setLineDashPattern([], 0);
    }
    if (logo) { const lw = 34, lh = lw * 395 / 900; try { pdf.addImage(logo, 'PNG', (W - lw) / 2, y, lw, lh); } catch (e) {} y += lh + 4; }
    pdf.setTextColor(0); pdf.setFont('helvetica', 'bold'); pdf.setFontSize(11);
    pdf.text(`BOLETIM ESCOLAR ${escola.ano || ''}`.trim(), W / 2, y, { align: 'center' }); y += 6;
    pdf.setFontSize(9.5); pdf.setFont('helvetica', 'normal');
    pdf.text('Aluno(a): ', M, y); pdf.setFont('helvetica', 'bold');
    pdf.text((a.nome || '').toUpperCase(), M + pdf.getTextWidth('Aluno(a): '), y);
    pdf.setFont('helvetica', 'normal');
    const serie = `Série: ${(turma.nome || '').toUpperCase()}`;
    pdf.text(serie, W - M, y, { align: 'right' });
    y += 2.5;
    const linhas = linhasBoletim(a.id, mapa);
    const n = v => (v === null || v === undefined ? '' : fmt(v));
    const f = v => (v === null || v === undefined ? '' : String(v));
    pdf.autoTable({
      startY: y, margin: { left: M, right: M }, theme: 'grid', tableWidth: W - 2 * M,
      head: [
        [{ content: 'Componentes\nCurriculares', rowSpan: 2 }, { content: 'NOTAS', colSpan: 4 }, { content: 'FALTAS', colSpan: 4 },
         { content: '5º\nCONCEITO', rowSpan: 2 }, { content: 'Total de\nFaltas', rowSpan: 2 }, { content: 'Resultado\nFinal', rowSpan: 2 }],
        ['1º BIM', '2º BIM', '3º BIM', '4º BIM', '1º BIM', '2º BIM', '3º BIM', '4º BIM'],
      ],
      body: linhas.map(l => [l.nome, ...l.notas.map(n), ...l.faltas.map(f), '', f(l.total), '']),
      styles: { font: 'helvetica', fontSize: 8.5, cellPadding: 1.1, lineColor: [0, 0, 0], lineWidth: 0.2, textColor: [0, 0, 0],
                fillColor: false, halign: 'center', valign: 'middle', overflow: 'linebreak' },
      headStyles: { fillColor: false, textColor: [0, 0, 0], fontStyle: 'bold', fontSize: 7.2, lineWidth: 0.2, lineColor: [0, 0, 0] },
      alternateRowStyles: { fillColor: false },
      columnStyles: { 0: { halign: 'left', cellWidth: 32 }, 1: { cellWidth: 12.5 }, 2: { cellWidth: 12.5 }, 3: { cellWidth: 12.5 }, 4: { cellWidth: 12.5 },
                      5: { cellWidth: 11 }, 6: { cellWidth: 11 }, 7: { cellWidth: 11 }, 8: { cellWidth: 11 }, 9: { cellWidth: 18 }, 10: { cellWidth: 17 } },
    });
    y = pdf.lastAutoTable.finalY + 4.5;
    pdf.setFontSize(8.8); pdf.setFont('helvetica', 'normal');
    const prof = (a.professora || turma.professora || '').toUpperCase();
    pdf.text(`Professora: ${prof}`, M, y);
    pdf.text(`Coordenadora Pedagógica: ${(escola.coordenadora || '').toUpperCase()}`, W - M, y, { align: 'right' });
    if (incluirObs) {
      const obs = [];
      linhas.forEach(l => l.obs.forEach(o => obs.push(`${l.nome} (${o.bim}º bim): ${o.texto}`)));
      if (obs.length) {
        y += 4.5; pdf.setFontSize(7.8);
        const txt = pdf.splitTextToSize('Observações: ' + obs.join('  •  '), W - 2 * M);
        pdf.text(txt.slice(0, 4), M, y);
      }
    }
  });
  return pdf;
}

export { NOME_DISC };
