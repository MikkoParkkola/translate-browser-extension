use wasm_bindgen::prelude::*;
use icu_segmenter::LineSegmenter;

#[wasm_bindgen]
pub fn line_break_points(text: &str) -> Vec<u32> {
    // Uses compiled_data feature; auto configuration selects reasonable defaults
    let seg = LineSegmenter::new_auto();
    let mut out = Vec::new();
    for idx in seg.segment_str(text) {
        out.push(idx as u32);
    }
    out
}
