import * as cheerio from 'cheerio';
import logger from '../../utils/logger.js';

/**
 * Extract color information from website pages
 */
export const extract = async (pages) => {
  try {
    logger.info('Extracting color information');
    
    // Get only HTML pages
    const htmlPages = pages.filter(page => 
      page.contentType && page.contentType.includes('text/html')
    );
    
    if (htmlPages.length === 0) {
      logger.warn('No HTML pages found for color extraction');
      return {
        primaryColor: null,
        secondaryColors: [],
        palette: []
      };
    }
    
    // Extract colors from the homepage (first page)
    const homepage = htmlPages[0];
    
    // Extract colors from CSS
    const colors = extractColorsFromCSS(homepage);
    
    // If no primary color is found, try to extract from the logo or hero image
    if (!colors.primaryColor) {
      // This would require image processing which we've removed since color-thief-node dependency was removed
      colors.primaryColor = null;
    }
    
    return colors;
  } catch (error) {
    logger.error(`Error extracting colors: ${error.message}`);
    return {
      primaryColor: null,
      secondaryColors: [],
      palette: []
    };
  }
};

/**
 * Extract colors from CSS
 */
function extractColorsFromCSS(page) {
  try {
    // Initialize result object
    const result = {
      primaryColor: null,
      secondaryColors: [],
      palette: []
    };
    
    // Regular expressions for finding colors
    const hexColorRegex = /#([0-9a-f]{3}){1,2}\b/gi;
    const rgbColorRegex = /rgb\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*\)/gi;
    const rgbaColorRegex = /rgba\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*,\s*[0-9.]+\s*\)/gi;
    const hslColorRegex = /hsl\(\s*\d+\s*,\s*\d+%\s*,\s*\d+%\s*\)/gi;
    const hslaColorRegex = /hsla\(\s*\d+\s*,\s*\d+%\s*,\s*\d+%\s*,\s*[0-9.]+\s*\)/gi;
    
    // Color name mapping (common CSS color names)
    const colorNameMapping = {
      'aliceblue': '#f0f8ff',
      'antiquewhite': '#faebd7',
      'aqua': '#00ffff',
      'aquamarine': '#7fffd4',
      'azure': '#f0ffff',
      'beige': '#f5f5dc',
      'bisque': '#ffe4c4',
      'black': '#000000',
      'blanchedalmond': '#ffebcd',
      'blue': '#0000ff',
      'blueviolet': '#8a2be2',
      'brown': '#a52a2a',
      'burlywood': '#deb887',
      'cadetblue': '#5f9ea0',
      'chartreuse': '#7fff00',
      'chocolate': '#d2691e',
      'coral': '#ff7f50',
      'cornflowerblue': '#6495ed',
      'cornsilk': '#fff8dc',
      'crimson': '#dc143c',
      'cyan': '#00ffff',
      'darkblue': '#00008b',
      'darkcyan': '#008b8b',
      'darkgoldenrod': '#b8860b',
      'darkgray': '#a9a9a9',
      'darkgreen': '#006400',
      'darkkhaki': '#bdb76b',
      'darkmagenta': '#8b008b',
      'darkolivegreen': '#556b2f',
      'darkorange': '#ff8c00',
      'darkorchid': '#9932cc',
      'darkred': '#8b0000',
      'darksalmon': '#e9967a',
      'darkseagreen': '#8fbc8f',
      'darkslateblue': '#483d8b',
      'darkslategray': '#2f4f4f',
      'darkturquoise': '#00ced1',
      'darkviolet': '#9400d3',
      'deeppink': '#ff1493',
      'deepskyblue': '#00bfff',
      'dimgray': '#696969',
      'dodgerblue': '#1e90ff',
      'firebrick': '#b22222',
      'floralwhite': '#fffaf0',
      'forestgreen': '#228b22',
      'fuchsia': '#ff00ff',
      'gainsboro': '#dcdcdc',
      'ghostwhite': '#f8f8ff',
      'gold': '#ffd700',
      'goldenrod': '#daa520',
      'gray': '#808080',
      'green': '#008000',
      'greenyellow': '#adff2f',
      'honeydew': '#f0fff0',
      'hotpink': '#ff69b4',
      'indianred': '#cd5c5c',
      'indigo': '#4b0082',
      'ivory': '#fffff0',
      'khaki': '#f0e68c',
      'lavender': '#e6e6fa',
      'lavenderblush': '#fff0f5',
      'lawngreen': '#7cfc00',
      'lemonchiffon': '#fffacd',
      'lightblue': '#add8e6',
      'lightcoral': '#f08080',
      'lightcyan': '#e0ffff',
      'lightgoldenrodyellow': '#fafad2',
      'lightgray': '#d3d3d3',
      'lightgreen': '#90ee90',
      'lightpink': '#ffb6c1',
      'lightsalmon': '#ffa07a',
      'lightseagreen': '#20b2aa',
      'lightskyblue': '#87cefa',
      'lightslategray': '#778899',
      'lightsteelblue': '#b0c4de',
      'lightyellow': '#ffffe0',
      'lime': '#00ff00',
      'limegreen': '#32cd32',
      'linen': '#faf0e6',
      'magenta': '#ff00ff',
      'maroon': '#800000',
      'mediumaquamarine': '#66cdaa',
      'mediumblue': '#0000cd',
      'mediumorchid': '#ba55d3',
      'mediumpurple': '#9370db',
      'mediumseagreen': '#3cb371',
      'mediumslateblue': '#7b68ee',
      'mediumspringgreen': '#00fa9a',
      'mediumturquoise': '#48d1cc',
      'mediumvioletred': '#c71585',
      'midnightblue': '#191970',
      'mintcream': '#f5fffa',
      'mistyrose': '#ffe4e1',
      'moccasin': '#ffe4b5',
      'navajowhite': '#ffdead',
      'navy': '#000080',
      'oldlace': '#fdf5e6',
      'olive': '#808000',
      'olivedrab': '#6b8e23',
      'orange': '#ffa500',
      'orangered': '#ff4500',
      'orchid': '#da70d6',
      'palegoldenrod': '#eee8aa',
      'palegreen': '#98fb98',
      'paleturquoise': '#afeeee',
      'palevioletred': '#db7093',
      'papayawhip': '#ffefd5',
      'peachpuff': '#ffdab9',
      'peru': '#cd853f',
      'pink': '#ffc0cb',
      'plum': '#dda0dd',
      'powderblue': '#b0e0e6',
      'purple': '#800080',
      'rebeccapurple': '#663399',
      'red': '#ff0000',
      'rosybrown': '#bc8f8f',
      'royalblue': '#4169e1',
      'saddlebrown': '#8b4513',
      'salmon': '#fa8072',
      'sandybrown': '#f4a460',
      'seagreen': '#2e8b57',
      'seashell': '#fff5ee',
      'sienna': '#a0522d',
      'silver': '#c0c0c0',
      'skyblue': '#87ceeb',
      'slateblue': '#6a5acd',
      'slategray': '#708090',
      'snow': '#fffafa',
      'springgreen': '#00ff7f',
      'steelblue': '#4682b4',
      'tan': '#d2b48c',
      'teal': '#008080',
      'thistle': '#d8bfd8',
      'tomato': '#ff6347',
      'turquoise': '#40e0d0',
      'violet': '#ee82ee',
      'wheat': '#f5deb3',
      'white': '#ffffff',
      'whitesmoke': '#f5f5f5',
      'yellow': '#ffff00',
      'yellowgreen': '#9acd32'
    };
    
    // Extract CSS from the page
    const css = extractCSS(page);
    
    // Find all hex colors
    const hexColors = css.match(hexColorRegex) || [];
    
    // Find all RGB colors
    const rgbColors = css.match(rgbColorRegex) || [];
    
    // Find all RGBA colors
    const rgbaColors = css.match(rgbaColorRegex) || [];
    
    // Find all HSL colors
    const hslColors = css.match(hslColorRegex) || [];
    
    // Find all HSLA colors
    const hslaColors = css.match(hslaColorRegex) || [];
    
    // Find all color names
    const colorNameRegex = new RegExp(Object.keys(colorNameMapping).join('|'), 'gi');
    const colorNames = css.match(colorNameRegex) || [];
    
    // Convert color names to hex
    const colorNamesAsHex = colorNames.map(name => colorNameMapping[name.toLowerCase()]);
    
    // Combine all colors
    const allColors = [
      ...hexColors,
      ...rgbColors,
      ...rgbaColors,
      ...hslColors,
      ...hslaColors,
      ...colorNamesAsHex
    ];
    
    // Count color occurrences
    const colorCounts = {};
    
    allColors.forEach(color => {
      const normalizedColor = color.toLowerCase();
      colorCounts[normalizedColor] = (colorCounts[normalizedColor] || 0) + 1;
    });
    
    // Sort colors by frequency
    const sortedColors = Object.keys(colorCounts).sort((a, b) => colorCounts[b] - colorCounts[a]);
    
    // Get the top colors
    const uniqueColors = [...new Set(sortedColors)];
    
    // Set primary color (most frequent)
    if (uniqueColors.length > 0) {
      result.primaryColor = uniqueColors[0];
    }
    
    // Set secondary colors (next 5 most frequent)
    if (uniqueColors.length > 1) {
      result.secondaryColors = uniqueColors.slice(1, 6);
    }
    
    // Set palette (up to 10 most frequent)
    if (uniqueColors.length > 0) {
      result.palette = uniqueColors.slice(0, 10);
    }
    
    return result;
  } catch (error) {
    logger.error(`Error extracting colors from CSS: ${error.message}`);
    return {
      primaryColor: null,
      secondaryColors: [],
      palette: []
    };
  }
}

/**
 * Extract CSS from a page
 */
function extractCSS(page) {
  try {
    let css = '';
    
    // Extract inline styles
    const styleRegex = /<style[^>]*>([\s\S]*?)<\/style>/gi;
    let match;
    
    while ((match = styleRegex.exec(page.content)) !== null) {
      css += match[1] + ' ';
    }
    
    // Extract style attributes
    const styleAttrRegex = /style="([^"]*)"/gi;
    
    while ((match = styleAttrRegex.exec(page.content)) !== null) {
      css += match[1] + ' ';
    }
    
    return css;
  } catch (error) {
    logger.error(`Error extracting CSS: ${error.message}`);
    return '';
  }
} 