use wasm_bindgen::prelude::*;
use icu_segmenter::LineBreakSegmenter;

#[wasm_bindgen]
pub fn line_break_points(text: &str) -> Vec<u32> {
    let seg = LineBreakSegmenter::try_new().expect("segmenter");
    let mut out = Vec::new();
    for (idx, _) in seg.segment_str(text) {
        out.push(idx as u32);
    }
    out
}

