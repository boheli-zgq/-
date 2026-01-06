
// Shared utility for image processing across all tools
// Handles standard images and TIFF files via UTIF.js

export const ensureUtifLoaded = async (): Promise<boolean> => {
    if ((window as any).UTIF) return true;
    
    return new Promise<boolean>((resolve) => {
        console.log("Loading UTIF library...");
        // Try jsdelivr first
        const script = document.createElement('script');
        script.src = "https://cdn.jsdelivr.net/npm/utif@3.1.0/UTIF.js";
        script.crossOrigin = "anonymous";
        script.onload = () => {
            console.log("UTIF loaded via jsdelivr");
            resolve(true);
        };
        script.onerror = () => {
             console.warn("UTIF jsdelivr failed, trying unpkg...");
             // Try fallback unpkg
             const script2 = document.createElement('script');
             script2.src = "https://unpkg.com/utif@3.1.0/UTIF.js";
             script2.onload = () => {
                 console.log("UTIF loaded via unpkg");
                 resolve(true);
             };
             script2.onerror = () => {
                 console.error("UTIF failed to load from all sources");
                 resolve(false);
             };
             document.body.appendChild(script2);
        };
        document.body.appendChild(script);
    });
};

export const processImageFile = async (file: File): Promise<string | null> => {
    const isTiff = file.type === 'image/tiff' || 
                   file.type === 'image/x-tiff' ||
                   file.name.toLowerCase().endsWith('.tif') || 
                   file.name.toLowerCase().endsWith('.tiff');
    
    if (!isTiff) {
        return URL.createObjectURL(file);
    }

    try {
        const loaded = await ensureUtifLoaded();
        if (!loaded) {
            alert("无法加载 TIFF 处理库，请检查网络或使用 JPG/PNG 图片。");
            return null;
        }
        
        const utifLib = (window as any).UTIF;
        if (!utifLib) return null;

        const buffer = await file.arrayBuffer();
        const ifds = utifLib.decode(buffer);
        if (ifds && ifds.length > 0) {
            const page = ifds[0];
            utifLib.decodeImage(buffer, page);
            const rgba = utifLib.toRGBA8(page);
            const canvas = document.createElement('canvas');
            canvas.width = page.width;
            canvas.height = page.height;
            const ctx = canvas.getContext('2d');
            if (ctx) {
                const imageData = ctx.createImageData(page.width, page.height);
                imageData.data.set(rgba);
                ctx.putImageData(imageData, 0, 0);
                return new Promise((resolve) => {
                    canvas.toBlob((blob) => {
                        resolve(blob ? URL.createObjectURL(blob) : null);
                    }, 'image/png');
                });
            }
        }
    } catch (e: any) {
        console.error("TIFF processing error:", e);
        const msg = e instanceof Error ? e.message : String(e);
        alert(`图片解析失败: ${msg}`);
    }
    return null;
};
