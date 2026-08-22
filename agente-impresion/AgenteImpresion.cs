// ─────────────────────────────────────────────────────────────────────────────
// AGENTE DE IMPRESIÓN AGROCAR — puente entre el ERP web y la ticketera
//
// El ERP corre en el navegador y no puede hablarle directo a la impresora: todo
// pasa por el driver de Windows, que rasteriza la página a imagen —673 KB por
// ticket— y decide el corte según el tamaño de papel. De ahí venía el papel
// desperdiciado: el driver agrega su propio margen final y no hay forma de
// pedirle "cortá acá".
//
// Este agente recibe del ERP los bytes ESC/POS ya armados y los manda a la
// impresora en modo RAW, sin pasar por el rasterizado. El corte lo decide el
// ticket con el comando GS V y no el driver: 172 bytes en vez de 673 KB, y el
// papel avanza solo lo necesario.
//
// No usa HttpListener a propósito: ese exige registrar la URL con permisos de
// administrador. Con TcpListener sobre loopback arranca sin pedir nada.
//
// Compilar (el compilador viene con Windows, no hay que instalar nada):
//   %SystemRoot%\Microsoft.NET\Framework64\v4.0.30319\csc.exe
//     /target:winexe /out:AgenteImpresionAgrocar.exe
//     /reference:System.Drawing.dll /reference:System.Windows.Forms.dll
//     AgenteImpresion.cs
// ─────────────────────────────────────────────────────────────────────────────

using System;
using System.Collections.Generic;
using System.IO;
using System.Net;
using System.Net.Sockets;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

class Agente
{
    const int PUERTO = 9123;
    const string VERSION = "1.0";

    // ── Impresión RAW por el spooler de Windows ──────────────────────────────
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    class DOCINFO
    {
        [MarshalAs(UnmanagedType.LPWStr)] public string pDocName;
        [MarshalAs(UnmanagedType.LPWStr)] public string pOutputFile;
        [MarshalAs(UnmanagedType.LPWStr)] public string pDataType;
    }

    [DllImport("winspool.Drv", CharSet = CharSet.Unicode, SetLastError = true)]
    static extern bool OpenPrinter(string src, out IntPtr h, IntPtr pd);
    [DllImport("winspool.Drv", SetLastError = true)]
    static extern bool ClosePrinter(IntPtr h);
    [DllImport("winspool.Drv", CharSet = CharSet.Unicode, SetLastError = true)]
    static extern bool StartDocPrinter(IntPtr h, int lvl, [In, MarshalAs(UnmanagedType.LPStruct)] DOCINFO di);
    [DllImport("winspool.Drv", SetLastError = true)]
    static extern bool EndDocPrinter(IntPtr h);
    [DllImport("winspool.Drv", SetLastError = true)]
    static extern bool StartPagePrinter(IntPtr h);
    [DllImport("winspool.Drv", SetLastError = true)]
    static extern bool EndPagePrinter(IntPtr h);
    [DllImport("winspool.Drv", SetLastError = true)]
    static extern bool WritePrinter(IntPtr h, IntPtr buf, int n, out int written);

    static string ImprimirRaw(string impresora, byte[] datos)
    {
        IntPtr hp;
        if (!OpenPrinter(impresora, out hp, IntPtr.Zero))
            return "No se pudo abrir la impresora " + impresora + " (error " + Marshal.GetLastWin32Error() + ")";

        var di = new DOCINFO();
        di.pDocName = "AGROCAR ticket";
        di.pDataType = "RAW";
        if (!StartDocPrinter(hp, 1, di)) { ClosePrinter(hp); return "StartDocPrinter fallo"; }

        StartPagePrinter(hp);
        IntPtr p = Marshal.AllocCoTaskMem(datos.Length);
        Marshal.Copy(datos, 0, p, datos.Length);
        int escritos;
        bool ok = WritePrinter(hp, p, datos.Length, out escritos);
        Marshal.FreeCoTaskMem(p);
        EndPagePrinter(hp);
        EndDocPrinter(hp);
        ClosePrinter(hp);

        return ok ? null : "WritePrinter fallo";
    }

    static List<string> Impresoras()
    {
        var lista = new List<string>();
        try
        {
            foreach (string n in System.Drawing.Printing.PrinterSettings.InstalledPrinters)
                lista.Add(n);
        }
        catch { }
        return lista;
    }

    // ── JSON a mano, para no arrastrar dependencias ──────────────────────────
    static string Campo(string json, string nombre)
    {
        string marca = "\"" + nombre + "\"";
        int i = json.IndexOf(marca, StringComparison.Ordinal);
        if (i < 0) return null;
        i = json.IndexOf(':', i + marca.Length);
        if (i < 0) return null;
        i++;
        while (i < json.Length && (json[i] == ' ' || json[i] == '\t')) i++;
        if (i >= json.Length || json[i] != '"') return null;
        i++;
        var sb = new StringBuilder();
        while (i < json.Length && json[i] != '"')
        {
            if (json[i] == '\\' && i + 1 < json.Length) i++;
            sb.Append(json[i]);
            i++;
        }
        return sb.ToString();
    }

    static string Escapar(string s)
    {
        if (s == null) return "";
        return s.Replace("\\", "\\\\").Replace("\"", "\\\"");
    }

    static void Main(string[] args)
    {
        TcpListener servidor;
        try
        {
            servidor = new TcpListener(IPAddress.Loopback, PUERTO);
            servidor.Start();
        }
        catch (Exception e)
        {
            MostrarError("No se pudo abrir el puerto " + PUERTO + ".\r\n\r\n" +
                         "Puede que el agente ya este corriendo.\r\n\r\n" + e.Message);
            return;
        }

        while (true)
        {
            try
            {
                TcpClient cliente = servidor.AcceptTcpClient();
                ThreadPool.QueueUserWorkItem(delegate(object o) { Atender(cliente); });
            }
            catch { }
        }
    }

    static void MostrarError(string msg)
    {
        try { System.Windows.Forms.MessageBox.Show(msg, "Agente de impresion AGROCAR"); }
        catch { Console.Error.WriteLine(msg); }
    }

    static void Atender(TcpClient cliente)
    {
        try
        {
            using (cliente)
            {
                NetworkStream flujo = cliente.GetStream();
                cliente.ReceiveTimeout = 10000;

                byte[] buffer = new byte[8192];
                MemoryStream crudo = new MemoryStream();
                int leidos, largoCuerpo = -1, finCabeceras = -1;

                while ((leidos = flujo.Read(buffer, 0, buffer.Length)) > 0)
                {
                    crudo.Write(buffer, 0, leidos);
                    string texto = Encoding.UTF8.GetString(crudo.ToArray());

                    if (finCabeceras < 0)
                    {
                        int corte = texto.IndexOf("\r\n\r\n", StringComparison.Ordinal);
                        if (corte >= 0)
                        {
                            finCabeceras = corte + 4;
                            foreach (string linea in texto.Substring(0, corte).Split('\n'))
                            {
                                string l = linea.Trim();
                                if (l.StartsWith("Content-Length:", StringComparison.OrdinalIgnoreCase))
                                    int.TryParse(l.Substring(15).Trim(), out largoCuerpo);
                            }
                        }
                    }
                    if (finCabeceras >= 0)
                    {
                        int yaLeido = crudo.Length > finCabeceras ? (int)crudo.Length - finCabeceras : 0;
                        if (largoCuerpo <= 0 || yaLeido >= largoCuerpo) break;
                    }
                }

                string completo = Encoding.UTF8.GetString(crudo.ToArray());
                if (completo.Length == 0) return;

                string primera = completo.Split('\n')[0].Trim();
                string[] partes = primera.Split(' ');
                string metodo = partes.Length > 0 ? partes[0] : "";
                string ruta = partes.Length > 1 ? partes[1] : "/";
                string cuerpo = (finCabeceras >= 0 && completo.Length > finCabeceras)
                    ? completo.Substring(finCabeceras) : "";

                if (metodo == "OPTIONS") { Responder(flujo, 204, ""); return; }

                if (ruta.StartsWith("/ping"))
                {
                    StringBuilder sb = new StringBuilder();
                    sb.Append("{\"ok\":true,\"version\":\"").Append(VERSION).Append("\",\"impresoras\":[");
                    List<string> lista = Impresoras();
                    for (int i = 0; i < lista.Count; i++)
                    {
                        if (i > 0) sb.Append(',');
                        sb.Append('"').Append(Escapar(lista[i])).Append('"');
                    }
                    sb.Append("]}");
                    Responder(flujo, 200, sb.ToString());
                    return;
                }

                if (ruta.StartsWith("/imprimir") && metodo == "POST")
                {
                    string impresora = Campo(cuerpo, "impresora");
                    string b64 = Campo(cuerpo, "base64");

                    if (string.IsNullOrEmpty(b64))
                    {
                        Responder(flujo, 400, "{\"ok\":false,\"error\":\"falta el contenido a imprimir\"}");
                        return;
                    }
                    if (string.IsNullOrEmpty(impresora))
                    {
                        foreach (string n in Impresoras())
                        {
                            if (n.IndexOf("POS", StringComparison.OrdinalIgnoreCase) >= 0 ||
                                n.IndexOf("80", StringComparison.Ordinal) >= 0)
                            { impresora = n; break; }
                        }
                    }
                    if (string.IsNullOrEmpty(impresora))
                    {
                        Responder(flujo, 400, "{\"ok\":false,\"error\":\"no se indico impresora y no se encontro ninguna ticketera\"}");
                        return;
                    }

                    byte[] datos;
                    try { datos = Convert.FromBase64String(b64); }
                    catch { Responder(flujo, 400, "{\"ok\":false,\"error\":\"contenido mal codificado\"}"); return; }

                    string error = ImprimirRaw(impresora, datos);
                    if (error == null)
                        Responder(flujo, 200, "{\"ok\":true,\"bytes\":" + datos.Length + "}");
                    else
                        Responder(flujo, 500, "{\"ok\":false,\"error\":\"" + Escapar(error) + "\"}");
                    return;
                }

                Responder(flujo, 404, "{\"ok\":false,\"error\":\"ruta desconocida\"}");
            }
        }
        catch { }
    }

    static void Responder(NetworkStream flujo, int codigo, string json)
    {
        byte[] cuerpo = Encoding.UTF8.GetBytes(json);
        StringBuilder c = new StringBuilder();
        c.Append("HTTP/1.1 ").Append(codigo).Append(codigo == 200 ? " OK" : " X").Append("\r\n");
        c.Append("Content-Type: application/json; charset=utf-8\r\n");
        // El ERP corre en otro origen (https://...vercel.app): sin estas
        // cabeceras el navegador descarta la respuesta aunque haya impreso bien.
        c.Append("Access-Control-Allow-Origin: *\r\n");
        c.Append("Access-Control-Allow-Methods: GET, POST, OPTIONS\r\n");
        c.Append("Access-Control-Allow-Headers: Content-Type\r\n");
        c.Append("Access-Control-Max-Age: 86400\r\n");
        c.Append("Content-Length: ").Append(cuerpo.Length).Append("\r\n");
        c.Append("Connection: close\r\n\r\n");

        byte[] bc = Encoding.UTF8.GetBytes(c.ToString());
        flujo.Write(bc, 0, bc.Length);
        if (cuerpo.Length > 0) flujo.Write(cuerpo, 0, cuerpo.Length);
        flujo.Flush();
    }
}
