import 'dotenv/config';
import { db } from './client';

async function seed() {
  const client = await db.connect();
  try {
    await client.query('BEGIN');

    // Elimina e ricrea il ristorante
    await client.query(`DELETE FROM restaurants WHERE slug='gusto-alcazabilla'`);

    const restRes = await client.query(`
      INSERT INTO restaurants (name, slug, pos_config)
      VALUES ('Gusto Alcazabilla', 'gusto-alcazabilla', '{}')
      RETURNING id
    `);
    const rid = restRes.rows[0].id;
    console.log('Restaurant ID:', rid);

    // Tavoli
    for (let i = 1; i <= 20; i++) {
      await client.query(`
        INSERT INTO tables (restaurant_id, number, qr_code)
        VALUES ($1, $2, $3) ON CONFLICT DO NOTHING
      `, [rid, i, `gusto-alcazabilla-t${i}`]);
    }
    console.log('Tavoli: 20');

    const dishes = [
      // ─── ANTIPASTI / ENTRANTES ───
      { name: 'Pane all\'Aglio', desc: 'Pan tostado con aceite de ajo, orégano y mozzarella', price: 4.00, cat: 'antipasti' },
      { name: 'Focaccia', desc: 'Masa de pizza con aceite de oliva y orégano', price: 5.00, cat: 'antipasti' },
      { name: 'Bruschetta al Pomodoro', desc: 'Pan tostado con tomate cherry, aceite de oliva virgen y orégano', price: 7.00, cat: 'antipasti' },
      { name: 'Provoletta al Forno', desc: 'Provolone italiano horneado con orégano y pan tostado casero', price: 8.00, cat: 'antipasti' },
      { name: 'Parmigiana di Melanzane', desc: 'Berenjenas fritas y horneadas con queso parmesano, mozzarella y salsa de tomate', price: 10.00, cat: 'antipasti' },
      { name: 'Tagliere Bologna', desc: 'Tabla de mortadela de bologna con pistacho, queso ricota, miel y nueces', price: 13.00, cat: 'antipasti' },
      { name: 'Tagliere Italia', desc: 'Tabla de jamón de parma D.O.P y queso mozzarella de bufala D.O.P', price: 15.00, cat: 'antipasti' },
      { name: 'Tagliere dello Chef', desc: 'Surtido de embutidos y queso italiano a fantasía del chef', price: 15.00, cat: 'antipasti' },
      { name: 'Degustazione Burrate', desc: 'Degustación de dos tipos de queso burrata (normal y de trufa)', price: 13.00, cat: 'antipasti' },
      { name: 'Carpaccio', desc: 'Carpaccio de ternera, rúcula, escamas de parmesano y tomates cherry', price: 13.00, cat: 'antipasti' },

      // ─── ENSALADAS ───
      { name: 'Caesar Salad', desc: 'Lechuga romana con pollo a la plancha, bacon, picatostes, tomate, maíz y salsa césar', price: 12.00, cat: 'antipasti' },
      { name: 'Caprese', desc: 'Queso mozzarella di bufala D.O.P, tomate y orégano', price: 11.00, cat: 'antipasti' },
      { name: 'Nostromo', desc: 'Filete de atún, ensalada mixta, aceitunas negras, tomate cherry y cebolla roja', price: 12.00, cat: 'antipasti' },
      { name: 'Ensalada del Pastore', desc: 'Espinacas baby, queso de cabra a la plancha, tomate cherry, nueces y glaseado de vinagre balsámico y miel', price: 12.00, cat: 'antipasti' },

      // ─── PASTA CLASSICA ───
      { name: 'Bolognese', desc: 'Tagliatelle con salsa de tomate, carne picada, albahaca y queso parmesano', price: 12.00, cat: 'primi' },
      { name: 'Arrabiata', desc: 'Penne, salsa de tomate, ajo, guindilla y perejil', price: 11.00, cat: 'primi' },
      { name: 'Gnocchi Quattro Formaggi', desc: 'Gnocchi con salsa de cuatro quesos: fontina, gorgonzola, parmesano y pecorino', price: 12.00, cat: 'primi' },
      { name: 'Penne al Pesto', desc: 'Penne con salsa de albahaca, frutos secos y queso parmesano', price: 11.00, cat: 'primi' },

      // ─── CARBONARAS ───
      { name: 'Carbonara', desc: 'Spaghetti con guanciale, huevo, queso pecorino, parmesano y pimienta', price: 11.00, cat: 'primi' },
      { name: 'Carbonara Spicy', desc: 'Spaghetti con guanciale, huevo, nduja picante, parmesano, pecorino y pimienta negra', price: 13.00, cat: 'primi' },
      { name: 'Carbonara al Tartufo', desc: 'Spaghetti con guanciale, huevo, trufa negra italiana, parmesano y pecorino romano', price: 15.00, cat: 'primi' },
      { name: 'Carbonara al Pistacchio', desc: 'Spaghetti con guanciale, crema de pistacho, granella di pistacchio, huevo, pecorino y parmesano', price: 15.00, cat: 'primi' },

      // ─── PASTA SPECIALE ───
      { name: 'Tagliatella Toscana', desc: 'Tagliatella con trufa negra, salchicha fresca napolitana, setas y queso parmesano', price: 14.00, cat: 'primi' },
      { name: 'Pistacchino', desc: 'Paccheri con pesto de pistacho, bacon italiano crujiente y crema de burrata', price: 15.00, cat: 'primi' },
      { name: 'Little Italy', desc: 'Paccheri con albóndigas, salsa de tomate, queso ricota y parmesano', price: 13.00, cat: 'primi' },
      { name: 'Lo Scoglio', desc: 'Spaghetti con almejas, mejillones, calamar y tomate cherry', price: 16.00, cat: 'primi' },
      { name: 'Spaghetti all\'Astice', desc: 'Spaghetti con medio bogavante, tomate cherry y perejil', price: 21.00, cat: 'primi' },
      { name: 'Tagliatella Italia', desc: 'Tagliatelle con tomate cherry del piennolo, queso ricota, pesto de albahaca y parmesano', price: 21.00, cat: 'primi' },

      // ─── PASTA FRESCA ───
      { name: 'Ravioli Tartufo', desc: 'Pasta fresca rellena de crema de burrata con salsa de trufa, setas porcini, laurel, escamas de trufa negra y parmesano', price: 15.00, cat: 'primi' },
      { name: 'Ravioli Delicato', desc: 'Pasta fresca rellena de pera con salsa de gorgonzola, achicoria roja y parmesano', price: 14.00, cat: 'primi' },
      { name: 'Raviolo Capri', desc: 'Pasta fresca rellena de vieira y gambas con tomate cherry del piennolo', price: 15.00, cat: 'primi' },
      { name: 'Raviolo Spinaci', desc: 'Pasta fresca rellena de espinacas y queso ricota de bufala con salsa de tomate y parmesano', price: 13.00, cat: 'primi' },

      // ─── PASTA AL FORNO ───
      { name: 'Lasagna di Carne Napoletana', desc: 'Láminas de pasta con salsa de tomate, carne picada, ricota, mozzarella, parmesano y albahaca', price: 13.00, cat: 'primi' },
      { name: 'Gnocchi della Nonna', desc: 'Pasta de patata fresca horneada con salsa de tomate, mozzarella, parmesano y albahaca', price: 11.00, cat: 'primi' },

      // ─── RISOTTI ───
      { name: 'Risotto Norcino', desc: 'Arroz con setas porcini, trufa negra italiana y queso parmesano', price: 15.00, cat: 'primi' },
      { name: 'Risotto Profumo di Mare', desc: 'Arroz con tomate cherry, almejas, mejillones, calamar y perejil', price: 16.00, cat: 'primi' },

      // ─── CARNE ───
      { name: 'Pollo alla Griglia', desc: 'Filete de pollo a la plancha con guarnición de patata horneada o ensalada mixta', price: 15.00, cat: 'secondi' },
      { name: 'Entrecot de Vaca', desc: 'Entrecot a la plancha con guarnición de patata horneada o ensalada mixta', price: 25.00, cat: 'secondi' },

      // ─── PESCE ───
      { name: 'Pulpo a la Brasa', desc: 'Pulpo a la brasa con guarnición de patata horneada o ensalada mixta', price: 26.00, cat: 'secondi' },
      { name: 'Salmón a la Plancha', desc: 'Salmón a la plancha con guarnición de patata horneada o ensalada mixta', price: 18.00, cat: 'secondi' },

      // ─── PIZZA CLASSICHE ───
      { name: 'Pizza Marinara', desc: 'Salsa de tomate, ajo y orégano', price: 7.00, cat: 'pizze' },
      { name: 'Pizza Margherita', desc: 'Salsa de tomate, mozzarella, albahaca y parmesano', price: 9.00, cat: 'pizze' },
      { name: 'Pizza Margherita con Cotto', desc: 'Salsa de tomate, mozzarella, jamón cocido, albahaca y parmesano', price: 10.00, cat: 'pizze' },
      { name: 'Pizza Cotto e Funghi', desc: 'Salsa de tomate, mozzarella, jamón cocido, champiñones, albahaca y parmesano', price: 11.00, cat: 'pizze' },
      { name: 'Pizza Margherita al Salame', desc: 'Salsa de tomate, mozzarella, salami napolitano y parmesano', price: 10.00, cat: 'pizze' },
      { name: 'Pizza Diavola', desc: 'Salsa de tomate, mozzarella, salami picante y aceite picante', price: 11.00, cat: 'pizze' },
      { name: 'Pizza Capricciosa', desc: 'Salsa de tomate, mozzarella, jamón cocido, champiñones, aceitunas negras, alcachofas, albahaca y parmesano', price: 12.00, cat: 'pizze' },
      { name: 'Pizza Romana', desc: 'Salsa de tomate, mozzarella, anchoas, aceitunas negras y albahaca', price: 11.00, cat: 'pizze' },
      { name: 'Pizza Siciliana', desc: 'Salsa de tomate, berenjena frita, mozzarella, parmesano y albahaca', price: 10.00, cat: 'pizze' },
      { name: 'Pizza Quattro Formaggi', desc: 'Mozzarella, gorgonzola, fontina y parmesano', price: 11.00, cat: 'pizze' },
      { name: 'Calzone Napoletano', desc: 'Ricota, salami napolitano, salsa de tomate, parmesano, pimienta negra y albahaca', price: 13.00, cat: 'pizze' },

      // ─── PIZZA SPECIALI ───
      { name: 'Pizza Vegetariana', desc: 'Mozzarella, tomate cherry, berenjena, calabacín, pimiento verde, parmesano y albahaca', price: 11.00, cat: 'pizze' },
      { name: 'Pizza Lasagna', desc: 'Salsa de tomate, carne picada, ricota, mozzarella, parmesano y albahaca', price: 13.00, cat: 'pizze' },
      { name: 'Pizza Tricolore', desc: 'Mozzarella, rúcula, tomates cherry, jamón de parma y escamas de parmesano', price: 13.00, cat: 'pizze' },
      { name: 'Pizza Cipollara', desc: 'Mozzarella, tomate cherry, cebolla, atún y aceitunas negras', price: 12.00, cat: 'pizze' },
      { name: 'Pizza Rusticana', desc: 'Mozzarella, champiñones, patatas al horno, salchicha fresca napolitana y parmesano', price: 12.00, cat: 'pizze' },
      { name: 'Pizza Carciofina', desc: 'Alcachofas, mozzarella, albahaca, salami napoli y parmesano', price: 14.00, cat: 'pizze' },
      { name: 'Pizza Gennarino', desc: 'Mozzarella, ricota, salami napolitano, berenjena, albahaca, aceite de oliva y parmesano', price: 14.00, cat: 'pizze' },
      { name: 'Pizza Mr. Polpettino', desc: 'Salsa ragù napolitana, albóndiga frita, mozzarella, berenjena frita, parmesano y albahaca', price: 13.00, cat: 'pizze' },
      { name: 'Pizza Salsiccia e Friarielli', desc: 'Mozzarella, salchicha fresca napolitana, friarielli de nápoles y aceite de oliva', price: 12.00, cat: 'pizze' },
      { name: 'Pizza Sempre Verde', desc: 'Pesto italiano, tomate piennolo, mozzarella, albahaca y tarallo napolitano', price: 12.00, cat: 'pizze' },
      { name: 'Pizza Carbonara', desc: 'Pancetta, yema de huevo, parmesano y pimienta negra', price: 12.00, cat: 'pizze' },
      { name: 'Pizza Scarpariello', desc: 'Burrata, salsa de tomate, tomate San Marzano D.O.P., tomate cherry del Piennolo, parmesano, albahaca, pimienta negra y aceite de oliva', price: 13.00, cat: 'pizze' },

      // ─── PIZZA GOURMET ───
      { name: 'Pizza Margherita D.O.C.', desc: 'Salsa de tomate, mozzarella de bufala, albahaca y aceite de oliva', price: 12.00, cat: 'pizze' },
      { name: 'Pizza Marinara 4 Pomodori', desc: 'Tomates del piennolo rojo y amarillo, cherry, san Marzano, albahaca, orégano, ajo, parmesano y aceite de oliva', price: 10.00, cat: 'pizze' },
      { name: 'Pizza Super Diavola', desc: 'Mozzarella, salsa de tomate, nduja picante, salami picante, ricota, albahaca, parmesano y aceite de oliva', price: 14.00, cat: 'pizze' },
      { name: 'Pizza Super Quattro Formaggi', desc: 'Mozzarella, gorgonzola, fontina, parmesano, queso de cabra, nueces y miel', price: 14.00, cat: 'pizze' },
      { name: 'Pizza Tartufata', desc: 'Mozzarella, yema de huevo, champiñones, escamas de trufa negra italiana y parmesano', price: 13.00, cat: 'pizze' },
      { name: 'Pizza Miss Mortadella', desc: 'Mozzarella, ricota, mortadella de Bologna, pistachos y escamas de provolone', price: 13.00, cat: 'pizze' },
      { name: 'Pizza Burrata', desc: 'Carpaccio de ternera, rúcula, queso burrata, tomate cherry y escamas de parmesano', price: 16.00, cat: 'pizze' },
      { name: 'Pizza Pistacchiosa', desc: 'Mozzarella, crema de pistacho, bacon, burrata, granella di pistacchio, parmesano y albahaca', price: 16.00, cat: 'pizze' },
      { name: 'Pizza Golosa', desc: 'Mozzarella, salmón ahumado, queso ricota, cebolla, rúcula y tomate cherry', price: 15.00, cat: 'pizze' },
      { name: 'Pizza al Monte', desc: 'Mozzarella, seta porcino, champiñones, salsiccia, salsa de trufa negra italiana y escamas de parmesano', price: 16.00, cat: 'pizze' },
      { name: 'Pizza La Porcina', desc: 'Mozzarella, setas porcini, salsiccia, pancetta, parmesano, albahaca y aceite de oliva', price: 14.00, cat: 'pizze' },

      // ─── DOLCI ───
      { name: 'Tiramisù', desc: 'Crema a strati servita in un bicchiere, cosparsa di cacao', price: 7.00, cat: 'dolci' },
      { name: 'Pan di Stelle', desc: 'Postre en capas de crema y cacao con galleta Pan di Stelle', price: 8.00, cat: 'dolci' },
      { name: 'Cannolo Siciliano', desc: 'Canutillo crujiente relleno de crema de ricotta, terminado con chocolate y azúcar glas', price: 8.00, cat: 'dolci' },
      { name: 'Delizia al Limone', desc: 'Bizcocho esponjoso relleno y cubierto de crema de limón', price: 8.00, cat: 'dolci' },

      // ─── COCKTAILS ───
      { name: 'Aperol Spritz', desc: 'Aperol, cava, soda', price: 7.00, cat: 'cocktails' },
      { name: 'Hugo Spritz', desc: 'St. Germain, cava, soda', price: 8.00, cat: 'cocktails' },
      { name: 'Limoncello Spritz', desc: 'Sorbete de limón, aperol, limoncello y cava', price: 8.00, cat: 'cocktails' },
      { name: 'Mojito', desc: 'Ron, limón, azúcar, soda', price: 8.00, cat: 'cocktails' },
      { name: 'Negroni', desc: 'Martini rosso, Campari, gin', price: 8.00, cat: 'cocktails' },
      { name: 'Piña Colada', desc: 'Zumo piña, amaretto, ron, coco', price: 9.00, cat: 'cocktails' },
      { name: 'Sex on the Beach', desc: 'Vodka, naranja, fresa, licor melocotón', price: 8.00, cat: 'cocktails' },
      { name: 'Porno Star Martini', desc: 'Vodka, pasoa, maracuyá, limón, vainilla y cava', price: 8.50, cat: 'cocktails' },
      { name: 'Espresso Martini', desc: 'Vodka, licor de café, espresso, azúcar líquido', price: 9.00, cat: 'cocktails' },
      { name: 'Margarita', desc: 'Tequila, limón, triple seco', price: 8.00, cat: 'cocktails' },
      { name: 'The Italian Job', desc: 'Aperol, campari, martini, puré de mandarina y licor de melocotón', price: 9.00, cat: 'cocktails' },

      // ─── SPIRITS ───
      { name: 'Barcelo Añejo', desc: 'Ron dominicano añejo', price: 7.00, cat: 'spirits' },
      { name: 'Brugal Añejo', desc: 'Ron dominicano añejo', price: 7.00, cat: 'spirits' },
      { name: 'Zacapa 23', desc: 'Ron guatemalteco premium', price: 11.00, cat: 'spirits' },
      { name: 'Bacardi Blanco', desc: 'Ron blanco cubano', price: 7.00, cat: 'spirits' },
      { name: 'Tanqueray', desc: 'Gin londinense clásico', price: 7.00, cat: 'spirits' },
      { name: 'Tanqueray 00', desc: 'Gin sin alcohol', price: 7.00, cat: 'spirits' },
      { name: 'Larios', desc: 'Gin español', price: 7.00, cat: 'spirits' },
      { name: 'Beefeater', desc: 'Gin londinense', price: 7.00, cat: 'spirits' },
      { name: 'Hendrick\'s', desc: 'Gin escocés con pepino y rosa', price: 9.00, cat: 'spirits' },
      { name: 'Martin Miller', desc: 'Gin premium inglés', price: 9.00, cat: 'spirits' },
      { name: 'Monkey 47', desc: 'Gin alemán con 47 botánicos', price: 9.00, cat: 'spirits' },
      { name: 'Smirnoff', desc: 'Vodka ruso', price: 7.00, cat: 'spirits' },
      { name: 'Absolut', desc: 'Vodka sueco', price: 7.00, cat: 'spirits' },
      { name: 'Finlandia', desc: 'Vodka finlandés', price: 7.00, cat: 'spirits' },
      { name: 'Jack Daniel\'s', desc: 'Whisky americano Tennessee', price: 7.00, cat: 'spirits' },
      { name: 'J&B', desc: 'Scotch whisky blend', price: 7.00, cat: 'spirits' },
      { name: 'DYC 8', desc: 'Whisky español 8 años', price: 7.00, cat: 'spirits' },
      { name: 'Bulleit', desc: 'Bourbon americano', price: 8.50, cat: 'spirits' },
      { name: 'Chivas Regal', desc: 'Scotch whisky premium', price: 11.00, cat: 'spirits' },
      { name: 'Macallan', desc: 'Single malt scotch whisky', price: 11.00, cat: 'spirits' },
      { name: 'Belle de Reve', desc: 'Licor premium', price: 9.00, cat: 'spirits' },
      { name: 'José Cuervo Gold', desc: 'Tequila mexicano dorado', price: 7.00, cat: 'spirits' },
      { name: 'José Cuervo Silver', desc: 'Tequila mexicano blanco', price: 7.00, cat: 'spirits' },
      { name: 'Grappa Bianca', desc: 'Grappa italiana bianca', price: 5.00, cat: 'spirits' },
      { name: 'Grappa Barrique', desc: 'Grappa italiana invecchiata', price: 5.00, cat: 'spirits' },
      { name: 'Limoncello', desc: 'Licor de limón italiano', price: 5.00, cat: 'spirits' },
      { name: 'Melloncello', desc: 'Licor de melón italiano', price: 5.00, cat: 'spirits' },
      { name: 'Sambuca', desc: 'Licor de anís italiano', price: 5.00, cat: 'spirits' },
      { name: 'Amaro', desc: 'Licor amargo italiano', price: 5.00, cat: 'spirits' },
      { name: 'Vermut', desc: 'Vermut italiano', price: 4.00, cat: 'spirits' },
      { name: 'Brandy', desc: 'Brandy', price: 5.00, cat: 'spirits' },

      // ─── SOFT DRINKS ───
      { name: 'Coca Cola', desc: 'Refresco de cola', price: 3.00, cat: 'soft_drinks' },
      { name: 'Coca Cola Zero', desc: 'Refresco de cola sin azúcar', price: 3.00, cat: 'soft_drinks' },
      { name: 'Fanta Naranja', desc: 'Refresco de naranja', price: 3.00, cat: 'soft_drinks' },
      { name: 'Fanta Limón', desc: 'Refresco de limón', price: 3.00, cat: 'soft_drinks' },
      { name: 'Sprite', desc: 'Refresco de lima-limón', price: 3.00, cat: 'soft_drinks' },
      { name: 'Nestea', desc: 'Té frío con limón', price: 3.00, cat: 'soft_drinks' },
      { name: 'Aquarius', desc: 'Bebida isotónica', price: 3.00, cat: 'soft_drinks' },
      { name: 'Tónica', desc: 'Agua tónica', price: 3.00, cat: 'soft_drinks' },
      { name: 'Zumos', desc: 'Zumos de frutas', price: 3.00, cat: 'soft_drinks' },
      { name: 'Sangria', desc: 'Sangría de la casa', price: 5.00, cat: 'soft_drinks' },
      { name: 'Agua', desc: 'Agua mineral', price: 2.50, cat: 'soft_drinks' },

      // ─── BIRRE ───
      { name: 'San Miguel 30cl', desc: 'Cerveza española', price: 3.00, cat: 'birre' },
      { name: 'San Miguel 50cl', desc: 'Cerveza española grande', price: 4.00, cat: 'birre' },
      { name: 'San Miguel Sin Alcohol', desc: 'Cerveza sin alcohol', price: 3.00, cat: 'birre' },
      { name: 'Stella Artois 30cl', desc: 'Cerveza belga', price: 3.50, cat: 'birre' },
      { name: 'Stella Artois 50cl', desc: 'Cerveza belga grande', price: 5.00, cat: 'birre' },
      { name: 'Alhambra Verde', desc: 'Cerveza española premium sin gluten', price: 3.50, cat: 'birre' },
      { name: 'Peroni', desc: 'Cerveza italiana', price: 3.50, cat: 'birre' },
      { name: 'Ichnusa', desc: 'Cerveza italiana de Cerdeña', price: 3.50, cat: 'birre' },
      { name: 'Tinto de Verano 30cl', desc: 'Vino tinto con gaseosa', price: 4.00, cat: 'birre' },
      { name: 'Tinto de Verano 50cl', desc: 'Vino tinto con gaseosa grande', price: 5.00, cat: 'birre' },

      // ─── VINI ───
      { name: 'Pinot Grigio Doc Veneto', desc: 'Vino blanco italiano - copa €4 / botella €20', price: 20.00, cat: 'vini' },
      { name: 'Falanghina dei Feudi', desc: 'Vino blanco campano', price: 32.00, cat: 'vini' },
      { name: 'Pinot Grigio Trentino DOC', desc: 'Vino blanco del Trentino', price: 25.00, cat: 'vini' },
      { name: 'Chardonnay Langhe DOC', desc: 'Vino blanco piamontés', price: 39.00, cat: 'vini' },
      { name: 'Sauvignon IGT', desc: 'Vino blanco italiano - copa €4 / botella €22', price: 22.00, cat: 'vini' },
      { name: 'Moscato', desc: 'Vino blanco dulce italiano', price: 25.00, cat: 'vini' },
      { name: 'Müller Thurgau', desc: 'Vino blanco alpino', price: 26.00, cat: 'vini' },
      { name: 'Verdicchio', desc: 'Vino blanco de las Marcas', price: 27.00, cat: 'vini' },
      { name: 'Chardonnay IGT', desc: 'Vino blanco italiano', price: 22.00, cat: 'vini' },
      { name: 'Gewürztraminer DOC', desc: 'Vino blanco aromático del Alto Adigio', price: 33.00, cat: 'vini' },
      { name: 'Vermentino di Gallura', desc: 'Vino blanco sardo', price: 38.00, cat: 'vini' },
      { name: 'Fiano di Avellino', desc: 'Vino blanco campano premium', price: 40.00, cat: 'vini' },
      { name: 'Pinot Grigio Blush IGT', desc: 'Vino rosado italiano - copa €4 / botella €22', price: 22.00, cat: 'vini' },
      { name: 'Pipoli Rosato Basilicata IGP', desc: 'Vino rosado de Basilicata', price: 25.00, cat: 'vini' },
      { name: 'Merlot', desc: 'Vino tinto italiano - copa €4 / botella €20', price: 20.00, cat: 'vini' },
      { name: 'Rubrato dei Feudi', desc: 'Vino tinto campano Aglianico', price: 30.00, cat: 'vini' },
      { name: 'Montepulciano d\'Abruzzo', desc: 'Vino tinto abruzzese', price: 22.00, cat: 'vini' },
      { name: 'Negramaro IGP', desc: 'Vino tinto pugliese', price: 22.00, cat: 'vini' },
      { name: 'Nero d\'Avola DOC', desc: 'Vino tinto siciliano', price: 30.00, cat: 'vini' },
      { name: 'Pinot Nero Trentino DOC', desc: 'Vino tinto del Trentino', price: 26.00, cat: 'vini' },
      { name: 'Rosso Veneto IGT', desc: 'Vino tinto véneto', price: 29.00, cat: 'vini' },
      { name: 'Chianti Classico', desc: 'Vino tinto toscano DOCG', price: 37.00, cat: 'vini' },
      { name: 'Primitivo di Manduria DOP', desc: 'Vino tinto pugliese premium', price: 35.00, cat: 'vini' },
      { name: 'Ripasso della Valpolicella', desc: 'Vino tinto véneto', price: 37.00, cat: 'vini' },
      { name: 'Rosso di Montalcino', desc: 'Vino tinto toscano DOC', price: 40.00, cat: 'bevande' },
      { name: 'Barolo', desc: 'El rey de los vinos italianos - Piamonte DOCG', price: 73.00, cat: 'bevande' },
      { name: 'Brunello di Montalcino DOC', desc: 'Vino tinto toscano de élite', price: 95.00, cat: 'bevande' },
      { name: 'Amarone', desc: 'Vino tinto véneto premium', price: 110.00, cat: 'bevande' },

      // ─── VINI SPAGNOLI ───
      { name: 'Albariño', desc: 'Vino blanco gallego - copa €4 / botella €25', price: 25.00, cat: 'bevande' },
      { name: 'Verdejo', desc: 'Vino blanco de Rueda - copa €4 / botella €20', price: 20.00, cat: 'bevande' },
      { name: 'Rioja', desc: 'Vino tinto español - copa €4 / botella €25', price: 25.00, cat: 'bevande' },
      { name: 'Ribera del Duero', desc: 'Vino tinto español - copa €4 / botella €22', price: 22.00, cat: 'bevande' },

      // ─── SPUMANTI ───
      { name: 'Prosecco DOC', desc: 'Espumoso italiano', price: 23.00, cat: 'bevande' },
      { name: 'Prosecco Rosé DOC', desc: 'Espumoso italiano rosado', price: 23.00, cat: 'bevande' },
      { name: 'Lambrusco Tinto', desc: 'Espumoso tinto italiano - copa €4 / botella €16', price: 16.00, cat: 'vini' },
      { name: 'Lambrusco Rosé', desc: 'Espumoso rosado italiano - copa €4 / botella €16', price: 16.00, cat: 'vini' },
      { name: 'Franciacorta', desc: 'Espumoso italiano premium', price: 52.00, cat: 'vini' },
      { name: 'Cipriani Bellini', desc: 'Cóctel de prosecco y melocotón', price: 34.00, cat: 'vini' },
    ];

    let count = 0;
    for (const d of dishes) {
      await client.query(`
        INSERT INTO dishes (restaurant_id, name, description, price, category, available)
        VALUES ($1, $2, $3, $4, $5, true)
      `, [rid, d.name, d.desc, d.price, d.cat]);
      count++;
    }
    console.log(`Piatti inseriti: ${count}`);

    await client.query('COMMIT');
    console.log('✅ Gusto Alcazabilla inserito con successo!');
    console.log(`   ID: ${rid}`);
    console.log(`   QR tavolo 1: https://ai-restaurant-assistant-customer-ch.vercel.app?restaurant=gusto-alcazabilla&table=1`);
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('❌ Errore:', e);
    throw e;
  } finally {
    client.release();
    await db.end();
  }
}

seed();
