export interface MPEXImage {
    file_id: string;
    file_url: string;
};

export const MPEXImageJSONDesc = {
    '+@file_id': 'string',
    '+@file_url': 'string',
    '++': false
};

export default MPEXImage;