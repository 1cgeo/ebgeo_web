-- Widen the feature vocabulary without changing existing feature data.
ALTER TABLE features DROP CONSTRAINT valid_feature_type;
ALTER TABLE features ADD CONSTRAINT valid_feature_type CHECK (feature_type IN (
        'point', 'line', 'polygon', 'text', 'image',
        'circle', 'rectangle', 'ellipse', 'brush', 'sector',
        'arrow', 'boundary', 'occupied_front',
        'military_symbol', 'coordination_measure', 'engineering_symbol', 'coordination_line',
        'magnetic_declination',
        'los', 'visibility',
        'processed_los', 'processed_visibility'
    ));
