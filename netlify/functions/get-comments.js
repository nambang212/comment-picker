// File: netlify/functions/get-comments.js
// VERSI BARU: Mencoba mengambil data langsung dari Instagram.
// PERINGATAN: Metode ini sangat tidak stabil dan bisa berhenti bekerja kapan saja tanpa pemberitahuan
// karena bergantung pada struktur internal Instagram yang sering berubah.

// Fungsi untuk mengekstrak shortcode dari URL Instagram
const getShortcodeFromUrl = (url) => {
    const match = url.match(/(?:p|reel)\/([a-zA-Z0-9_-]+)/);
    return match ? match[1] : null;
};

// Fungsi untuk mengambil data komentar dari satu halaman (satu "batch")
async function fetchCommentPage(shortcode, endCursor = null) {
    // Ini adalah "query hash", semacam ID internal Instagram untuk jenis permintaan "ambil komentar".
    // Ini adalah bagian yang paling sering diubah oleh Instagram. Jika scraper berhenti bekerja, kemungkinan ini penyebabnya.
    const queryHash = 'bc3296d1ce80a24b1b6e40b1e72903f5';
    
    const variables = {
        shortcode: shortcode,
        first: 50, // Ambil 50 komentar per permintaan
    };

    if (endCursor) {
        variables.after = endCursor;
    }

    const apiUrl = `https://www.instagram.com/graphql/query/?query_hash=${queryHash}&variables=${JSON.stringify(variables)}`;

    // Kita sekarang menggunakan fetch bawaan Node.js, tidak perlu 'require' lagi.
    const response = await fetch(apiUrl, {
        headers: {
            // Menyamar sebagai browser biasa agar tidak langsung diblokir
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
            'Accept-Language': 'en-US,en;q=0.9',
            'Accept-Encoding': 'gzip, deflate, br',
            'Accept': '*/*',
            // Header ini penting untuk memberi tahu Instagram bahwa kita adalah aplikasi web mereka
            'X-IG-App-ID': '936619743392459' 
        }
    });

    if (!response.ok) {
        throw new Error(`Gagal menghubungi Instagram. Status: ${response.status}`);
    }

    const data = await response.json();

    // Cek jika Instagram merespons dengan error atau data kosong
    if (data.status === 'fail' || !data.data || !data.data.shortcode_media) {
        console.error('Respons tidak valid dari Instagram:', data);
        throw new Error('Instagram memblokir permintaan atau format data telah berubah.');
    }

    return data.data.shortcode_media.edge_media_to_parent_comment;
}


exports.handler = async function(event, context) {
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: 'Method Not Allowed' };
    }

    try {
        const { postUrl } = JSON.parse(event.body);
        const shortcode = getShortcodeFromUrl(postUrl);

        if (!shortcode) {
            return { statusCode: 400, body: 'URL postingan Instagram tidak valid.' };
        }

        let allComments = [];
        let hasNextPage = true;
        let endCursor = null;
        let pagesFetched = 0;
        const maxPages = 200; // Batas aman agar fungsi tidak berjalan terlalu lama (200 * 50 = 10.000 komentar)

        // Loop untuk mengambil semua halaman komentar (pagination)
        while (hasNextPage && pagesFetched < maxPages) {
            const commentData = await fetchCommentPage(shortcode, endCursor);
            
            const comments = commentData.edges.map(edge => ({
                username: edge.node.owner.username,
                komentar: edge.node.text,
                comment_id: edge.node.id,
                profile_pic_url: edge.node.owner.profile_pic_url
            }));
            
            allComments.push(...comments);

            hasNextPage = commentData.page_info.has_next_page;
            endCursor = commentData.page_info.end_cursor;
            pagesFetched++;
        }

        return {
            statusCode: 200,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(allComments),
        };

    } catch (error) {
        console.error('Error di Netlify function:', error);
        return {
            statusCode: 500,
            body: JSON.stringify({ error: error.message }),
        };
    }
};
