import { describe, expect, it } from 'vitest'

import type { OperatorList, PdfOps } from './pdfPageKind'
import { isReadable, pageSignals, planTextLayer } from './pdfPageKind'

const OPS: PdfOps = {
  save: 10,
  restore: 11,
  transform: 12,
  paintFormXObjectBegin: 74,
  paintFormXObjectEnd: 75,
  setTextRenderingMode: 20,
  showText: 44,
  showSpacedText: 45,
  nextLineShowText: 46,
  nextLineSetSpacingShowText: 47,
  constructPath: 91,
  paintImageXObject: 85,
  paintInlineImageXObject: 86,
  paintImageMaskXObject: 83,
}

const A4 = [0, 0, 596, 842]

function ops(...steps: [keyof PdfOps, unknown[]?][]): OperatorList {
  return { fnArray: steps.map(([name]) => OPS[name]), argsArray: steps.map(([, args]) => args ?? []) }
}

describe('pageSignals', () => {
  it('sees a phone scan: a full-page photo under an invisible OCR layer', () => {
    const scan = ops(
      ['save'], ['transform', [596, 0, 0, 842, 0, 0]], ['paintImageXObject', ['img1', 2480, 3508]], ['restore'],
      ['setTextRenderingMode', [3]], ['showText', [[]]], ['showText', [[]]],
    )
    const s = pageSignals(scan, A4, OPS)
    expect(s.imageCoverage).toBeCloseTo(1)
    expect(s.invisibleText).toBe(2)
    expect(s.visibleText).toBe(0)
  })

  it('measures images through nested transforms and forms, clipped to the page', () => {
    const list = ops(
      ['save'], ['transform', [2, 0, 0, 2, 0, 0]],
      ['paintFormXObjectBegin', [[1, 0, 0, 1, 10, 10], [0, 0, 1, 1]]],
      ['transform', [100, 0, 0, 50, 0, 0]], ['paintImageXObject', ['logo', 10, 10]], // 200 × 100 at (20, 20)
      ['paintFormXObjectEnd'], ['restore'],
      ['transform', [1000, 0, 0, 1000, 500, 800]], ['paintInlineImageXObject', [{}]], // mostly off the page
    )
    const s = pageSignals(list, A4, OPS)
    const expected = (200 * 100 + 96 * 42) / (596 * 842)
    expect(s.imageCoverage).toBeCloseTo(expected, 4)
  })

  it('restores the text render mode with the graphics state', () => {
    const list = ops(['save'], ['setTextRenderingMode', [3]], ['showText', [[]]], ['restore'], ['showSpacedText', [[]]], ['constructPath', [0, [], null]])
    expect(pageSignals(list, A4, OPS)).toMatchObject({ invisibleText: 1, visibleText: 1, paths: 1 })
  })
})

describe('isReadable', () => {
  it('accepts prose, maths-heavy pages, answer lines and other scripts', () => {
    expect(isReadable('Feedforward Neural Network (FNN) is a type of artificial neural network.')).toBe(true)
    expect(isReadable('Firm 1 Aggressive (7,2) (10,3) Accommodating (9,5) (11,4) a) Find the equilibrium . . . . . . . . . .')).toBe(true)
    expect(isReadable('सूचना पुनर्प्राप्ति प्रक्रिया समझाइए')).toBe(true)
    expect(isReadable('p. 12')).toBe(true) // too short to judge
  })

  it('rejects text from fonts without a Unicode map', () => {
    expect(isReadable('! " # $ % " & \'(  )  * " $ " ) ( " +  , - \' . (  / 0 # 1 % " 2 * ( 3 / " 4 * 0 "  5 / "')).toBe(false)
    expect(isReadable('* + , - . / 0 -1 2 3 4 / 5 6 - 7 5 / 8 9 7 9 2 : / ; - 8 / 7 / - / : 8 - < 9 = - 8 / 7 / + - > ? - . < 0 - @A')).toBe(false)
  })
})

describe('planTextLayer', () => {
  const base = { imageCoverage: 0, invisibleText: 0, visibleText: 40, paths: 20 }
  const typed = 'Deep learning mimics neural networks of the human brain.'

  it('trusts the text layer of a typed page', () => {
    expect(planTextLayer(base, typed)).toEqual({ keepText: true, needsVision: false })
    expect(planTextLayer({ ...base, imageCoverage: 0.03 }, typed)).toEqual({ keepText: true, needsVision: false }) // a small logo
  })

  it('drops an OCR layer and reads the scan with vision instead', () => {
    const scan = { ...base, imageCoverage: 1, invisibleText: 47, visibleText: 0 }
    expect(planTextLayer(scan, 'Fxplain Tnfsmation RotriuaPab.a Intohace wneod')).toEqual({ keepText: false, needsVision: true })
  })

  it('reads pages with no usable text layer with vision', () => {
    expect(planTextLayer({ ...base, visibleText: 0 }, '  ')).toEqual({ keepText: false, needsVision: true })
    expect(planTextLayer(base, '! " # $ % & \' ( ) * + , / 0 1 2 3 4 5 6 7 8 9 : ; < = > ?')).toEqual({ keepText: false, needsVision: true })
  })

  it('keeps exact text but also uses vision when pictures or drawings carry content', () => {
    expect(planTextLayer({ ...base, imageCoverage: 0.4 }, typed)).toEqual({ keepText: true, needsVision: true })
    expect(planTextLayer({ ...base, imageCoverage: 1 }, typed)).toEqual({ keepText: true, needsVision: true }) // slide with a photo background
    expect(planTextLayer({ ...base, paths: 2000 }, typed)).toEqual({ keepText: true, needsVision: true }) // ink exported from a tablet
  })
})
